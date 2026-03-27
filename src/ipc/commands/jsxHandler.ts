/**
 * @file jsxHandler.ts
 * @description Handler for the `jsx` command.
 *
 * Parses JSX markup → recursively creates Figma nodes via nodeFactory.
 * No intermediate IR — JsxNode tree walks directly into Figma API.
 * Uses rollback: all nodes created or none (atomic).
 *
 * Syntax:
 *   <frame name="Card" w={400} layout="column" p={24}>
 *     <text name="Title" size={24}>Card Title</text>
 *   </frame>
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { parseJsx, type JsxNode } from '../../engine/jsx/jsxParser';
import { TAG_TO_TYPE, coerceValue, computeDependsOn } from '../../engine/utils/prop-dsl';
import { normalizeProps } from '../../domain/node-normalizers';
import {
  createFrame, createText, createShape, createIcon,
  createComponent, createInstance, createComponentSet,
  cloneNode, prefetchIcons, tagAsAgentCreated,
  centerNodeInViewport, normalizeSizingInProps,
  type NodeResult,
} from '../../engine/actions/nodeFactory';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { scoreCreatedNodes, formatQualityReport } from './qualityScorer';
import { PipelineTracer } from './pipelineTracer';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface JsxNodeResult {
  nodeId: string;
  name: string;
  tag: string;
  childRefs: string[];  // "Name#id" format
}

const SHAPE_TYPES = new Set(['RECTANGLE', 'ELLIPSE', 'LINE', 'VECTOR']);

// ═══════════════════════════════════════════════════════════════════════════
// JSX Property Normalization (inlined from jsxToIR)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build raw props from JsxNode.attrs — type coercion, padding expansion.
 */
function buildRawProps(node: JsxNode): Record<string, any> {
  const name = (node.attrs.name as string) || node.tag;
  const rawProps: Record<string, any> = { name };

  for (const [key, value] of Object.entries(node.attrs)) {
    if (key === 'name' || key === 'ref' || key === 'variant') continue;

    // Expand object-valued padding into individual pt/pb/pl/pr
    if ((key === 'p' || key === 'padding') && typeof value === 'object' && value !== null) {
      const v = value as Record<string, number>;
      if (v.top != null || v.t != null) rawProps.pt = v.top ?? v.t;
      if (v.right != null || v.r != null) rawProps.pr = v.right ?? v.r;
      if (v.bottom != null || v.b != null) rawProps.pb = v.bottom ?? v.b;
      if (v.left != null || v.l != null) rawProps.pl = v.left ?? v.l;
      continue;
    }

    rawProps[key] = typeof value === 'string' ? coerceValue(key, value) : value;
  }

  return rawProps;
}

/**
 * Convert children's CSS-style mt/mb into parent gap (Figma has no margins).
 */
function applyMarginToGap(node: JsxNode, rawProps: Record<string, any>): void {
  const hasGap = rawProps.gap !== undefined;
  if (!hasGap && node.children.length > 1) {
    const marginValues: number[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const mt = child.attrs.mt ?? child.attrs.marginTop;
      const mb = child.attrs.mb ?? child.attrs.marginBottom;
      if (i > 0 && mt != null) marginValues.push(Number(mt));
      if (mb != null) marginValues.push(Number(mb));
    }
    if (marginValues.length > 0) {
      const freq = new Map<number, number>();
      for (const v of marginValues) freq.set(v, (freq.get(v) || 0) + 1);
      rawProps.gap = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    for (const child of node.children) {
      delete child.attrs.mt;
      delete child.attrs.mb;
      delete child.attrs.ml;
      delete child.attrs.mr;
      delete child.attrs.marginTop;
      delete child.attrs.marginBottom;
      delete child.attrs.marginLeft;
      delete child.attrs.marginRight;
    }
  }
}

/**
 * Inject layout defaults: frames with layout should default to hug if no explicit size.
 */
function applyLayoutDefaults(node: JsxNode, rawProps: Record<string, any>): void {
  const hasLayout = rawProps.layout !== undefined || rawProps.layoutMode !== undefined;
  const tag = node.tag;
  if (hasLayout && (tag === 'frame' || tag === 'section' || tag === 'component')) {
    if (rawProps.h === undefined && rawProps.height === undefined && rawProps.sizingV === undefined) {
      rawProps.h = 'hug';
    }
    if (rawProps.w === undefined && rawProps.width === undefined && rawProps.sizingH === undefined) {
      rawProps.w = 'hug';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Recursive Tree Executor
// ═══════════════════════════════════════════════════════════════════════════

interface WalkContext {
  symbolMap: Map<string, string>;  // symbol → real Figma ID
  rollbackStack: string[];          // node IDs for rollback
  warnings: Array<{ code: string; message: string }>;
  counter: number;
}

/**
 * Recursively create Figma nodes from a JsxNode tree.
 * Returns the result for response formatting.
 */
async function executeJsxNode(
  node: JsxNode,
  parentNode: SceneNode | null,
  ctx: WalkContext,
): Promise<JsxNodeResult | null> {
  const sym = `n${++ctx.counter}`;
  const name = (node.attrs.name as string) || node.tag;
  const pushWarn = (msg: string) => ctx.warnings.push({ code: 'NORMALIZE', message: msg });

  let result: NodeResult;

  try {
    // ── Instance: <instance ref="Button" variant="Size=Large"/> ──
    const refComponent = node.attrs.ref as string || '';
    if (node.tag === 'instance' || refComponent) {
      const compRef = refComponent || name;
      const variant = (node.attrs.variant as string) || undefined;
      const props: Record<string, any> = {};
      const overrides: Record<string, Record<string, any>> = {};

      for (const [key, value] of Object.entries(node.attrs)) {
        if (key === 'name') { props.name = value; continue; }
        if (key === 'ref' || key === 'variant') continue;
        if (key.startsWith('set:')) {
          overrides[key.substring(4)] = { characters: value };
          continue;
        }
        props[key] = typeof value === 'string' ? coerceValue(key, value) : value;
      }
      if (!props.name) props.name = name;

      const normalized = normalizeProps(props, {}, pushWarn);
      result = await createInstance(compRef, parentNode, normalized,
        Object.keys(overrides).length > 0 ? overrides : undefined,
        ctx.symbolMap, variant);

      // Error from component resolution
      if (!result.nodeId) {
        const errMsg = result.warnings[0]?.message || 'Instance creation failed';
        ctx.warnings.push({ code: 'INSTANCE_FAILED', message: errMsg });
        return null;
      }

    // ── Text node ──
    } else if (node.tag === 'text') {
      const rawProps = buildRawProps(node);
      if (node.textContent) rawProps.characters = node.textContent;
      const normalized = normalizeProps(rawProps, { nodeType: 'TEXT', isCreate: true }, pushWarn);
      normalizeSizingInProps(normalized, null, parentNode, true);
      result = await createText(parentNode, normalized);

    // ── Icon node ──
    } else if (node.tag === 'icon') {
      const rawProps = buildRawProps(node);
      const iconName = node.textContent || (rawProps.icon as string) || name;
      rawProps.iconName = iconName;
      delete rawProps.icon;

      if (rawProps.size !== undefined) {
        const s = typeof rawProps.size === 'string' ? coerceValue('width', rawProps.size) : rawProps.size;
        rawProps.width = s;
        rawProps.height = s;
        delete rawProps.size;
      }

      const normalized = normalizeProps(rawProps, {}, pushWarn);
      result = await createIcon(parentNode, normalized);

    // ── Image placeholder ──
    } else if (node.tag === 'image') {
      const rawProps = buildRawProps(node);
      applyMarginToGap(node, rawProps);
      applyLayoutDefaults(node, rawProps);
      const placeholder = rawProps.placeholder || rawProps.name || 'Image Placeholder';
      const dimProps: Record<string, any> = { name: placeholder };
      if (rawProps.width !== undefined) dimProps.width = rawProps.width;
      if (rawProps.height !== undefined) dimProps.height = rawProps.height;
      dimProps.fills = ['#E0E0E0'];
      Object.assign(dimProps, rawProps);
      dimProps.name = placeholder;
      const normalized = normalizeProps(dimProps, { nodeType: 'FRAME', isCreate: true }, pushWarn);
      normalizeSizingInProps(normalized, null, parentNode, false);
      result = await createFrame(parentNode, normalized);

    // ── Component node ──
    } else if (node.tag === 'component') {
      const rawProps = buildRawProps(node);
      applyMarginToGap(node, rawProps);
      applyLayoutDefaults(node, rawProps);
      const normalized = normalizeProps(rawProps, { nodeType: 'FRAME', isCreate: true }, pushWarn);
      normalizeSizingInProps(normalized, null, parentNode, false);
      result = await createComponent(parentNode, normalized, sym);

    // ── Shape nodes (rect, ellipse, line, vector) ──
    } else {
      const tag = node.tag;
      const figmaType = TAG_TO_TYPE[tag] || 'FRAME';

      const rawProps = buildRawProps(node);
      applyMarginToGap(node, rawProps);
      applyLayoutDefaults(node, rawProps);
      const normalized = normalizeProps(rawProps, { nodeType: figmaType, isCreate: true }, pushWarn);
      normalizeSizingInProps(normalized, null, parentNode, false);

      if (SHAPE_TYPES.has(figmaType)) {
        result = await createShape(figmaType, parentNode, normalized);
      } else {
        result = await createFrame(parentNode, normalized);
      }
    }
  } catch (e: any) {
    ctx.warnings.push({ code: 'CREATE_FAILED', message: `Failed to create <${node.tag} name="${name}"/>: ${e?.message}` });
    return null;
  }

  // Track for rollback and symbol resolution
  ctx.symbolMap.set(sym, result.nodeId);
  ctx.rollbackStack.push(result.nodeId);
  for (const w of result.warnings) {
    ctx.warnings.push({ code: w.code || 'PROP_WARNING', message: w.message || String(w) });
  }

  // Tag as agent-created
  try {
    const createdNode = await figma.getNodeByIdAsync(result.nodeId) as SceneNode;
    if (createdNode) tagAsAgentCreated(createdNode);
  } catch { /* best-effort */ }

  // ── Recurse children ──
  const childRefs: string[] = [];
  if (node.children.length > 0) {
    const createdNode = await figma.getNodeByIdAsync(result.nodeId) as SceneNode | null;
    for (const child of node.children) {
      const childResult = await executeJsxNode(child, createdNode, ctx);
      if (childResult) {
        childRefs.push(`${childResult.name}#${childResult.nodeId}`);
      }
    }
  }

  return { nodeId: result.nodeId, name, tag: node.tag, childRefs };
}

// ═══════════════════════════════════════════════════════════════════════════
// Public Handler
// ═══════════════════════════════════════════════════════════════════════════

export async function handleJsx(parameters: any): Promise<ToolResponse> {
  const { markup, parentId } = parameters;

  if (!markup || typeof markup !== 'string') {
    return {
      data: {
        message: 'jsx — Create design trees with nested JSX-like syntax.',
        usage: 'jsx({markup: "<frame name=\'Card\' w={400} layout=\'column\' p={24}>\\n  <text name=\'Title\' size={24}>Card Title</text>\\n</frame>"})',
        elements: ['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'instance', 'component', 'group', 'section', 'vector'],
        attributes: 'Same shorthands as mk: w, h, bg, layout, gap, p, corner, fill, size, weight, etc.',
      },
    };
  }

  const tracer = new PipelineTracer();

  // Step 1: Parse JSX markup → AST
  tracer.enter('parseJsx()', 'jsxParser.ts');
  const { roots, errors } = parseJsx(markup);
  tracer.exit({ roots: roots.length, errors: errors.length });

  if (roots.length === 0) {
    return {
      error: {
        code: 'PARSE_ERROR',
        message: errors.length > 0
          ? `Parse errors: ${errors.join('; ')}`
          : 'No valid elements found in JSX markup.',
      },
      _stages: tracer.collect(),
    };
  }

  // Step 2: Prefetch all icons in parallel
  const iconNames: string[] = [];
  function collectIcons(node: JsxNode): void {
    if (node.tag === 'icon') {
      const name = node.textContent || (node.attrs.icon as string) || (node.attrs.name as string) || node.tag;
      if (name) iconNames.push(name);
    }
    for (const child of node.children) collectIcons(child);
  }
  for (const root of roots) collectIcons(root);
  if (iconNames.length > 0) await prefetchIcons(iconNames);

  // Step 3: Resolve parent node
  let parentNode: SceneNode | null = null;
  if (parentId) {
    parentNode = await figma.getNodeByIdAsync(parentId) as SceneNode | null;
  }

  // Step 4: Execute — recursive tree walk
  tracer.enter('executeJsxTree()', 'jsxHandler.ts');
  const ctx: WalkContext = {
    symbolMap: new Map(),
    rollbackStack: [],
    warnings: [],
    counter: 0,
  };

  const rootResults: JsxNodeResult[] = [];
  let failed = false;

  try {
    for (const root of roots) {
      // Center root-level nodes in viewport if no explicit parent
      if (!parentNode) {
        const rawProps = buildRawProps(root);
        const isText = root.tag === 'text';
        const centered = centerNodeInViewport(rawProps, isText);
        // Apply centering back to node attrs
        if (centered.x !== undefined) root.attrs.x = centered.x;
        if (centered.y !== undefined) root.attrs.y = centered.y;
      }

      const result = await executeJsxNode(root, parentNode, ctx);
      if (result) {
        rootResults.push(result);
      } else {
        failed = true;
        break;
      }
    }
  } catch (e: any) {
    failed = true;
    ctx.warnings.push({ code: 'EXECUTION_ERROR', message: e?.message || 'Unexpected error' });
  }

  // Rollback on failure (atomic)
  if (failed) {
    for (const nodeId of [...ctx.rollbackStack].reverse()) {
      try {
        const node = await figma.getNodeByIdAsync(nodeId) as SceneNode | null;
        if (node && !node.removed) node.remove();
      } catch { /* best-effort */ }
    }
  }

  tracer.exit({ created: ctx.rollbackStack.length, failed });

  // Step 5: Build response
  const _stages = tracer.collect();

  if (failed || rootResults.length === 0) {
    const stderrLines = ctx.warnings.map(w => `[${w.code}] ${w.message}`);
    return {
      error: {
        code: 'EXECUTION_ERROR',
        message: ctx.warnings[ctx.warnings.length - 1]?.message || 'Failed to create design tree.',
      },
      _stderr: stderrLines.length > 0 ? stderrLines.join('\n') : undefined,
      _stages,
    };
  }

  // Build structured response via serializeMinimal pipeline
  const rootNodeId = rootResults[0].nodeId;
  const rootNode = await figma.getNodeByIdAsync(rootNodeId) as SceneNode | null;
  let data: Record<string, any>;
  if (rootNode) {
    const minimal = NodeSerializer.serializeMinimal(rootNode, true);
    data = JsonNodeSerializer.serialize(minimal, { minimal: true });
  } else {
    // Fallback if node lookup fails
    const rootData = rootResults[0];
    data = { id: rootData.nodeId, name: rootData.name, type: rootData.tag };
    if (rootData.childRefs.length > 0) data.children = rootData.childRefs;
  }
  if (rootResults.length > 1) {
    const roots: any[] = [];
    for (const r of rootResults) {
      const n = await figma.getNodeByIdAsync(r.nodeId) as SceneNode | null;
      if (n) {
        const m = NodeSerializer.serializeMinimal(n, true);
        roots.push(JsonNodeSerializer.serialize(m, { minimal: true }));
      } else {
        const d: any = { id: r.nodeId, name: r.name, type: r.tag };
        if (r.childRefs.length > 0) d.children = r.childRefs;
        roots.push(d);
      }
    }
    data.roots = roots;
  }

  // Build stderr from warnings
  let _stderr: string | undefined;
  if (ctx.warnings.length > 0) {
    _stderr = ctx.warnings.map(w => `[warn] ${w.message}`).join('\n');
  }

  // Append parse errors
  if (errors.length > 0) {
    const parseWarnings = errors.map(e => `[warn] ${e}`).join('\n');
    _stderr = _stderr ? parseWarnings + '\n' + _stderr : parseWarnings;
  }

  // Auto-pan viewport to newly created root node
  if (!parentId && rootResults.length > 0) {
    try {
      const newRootNode = await figma.getNodeByIdAsync(rootResults[0].nodeId);
      if (newRootNode) figma.viewport.scrollAndZoomIntoView([newRootNode as SceneNode]);
    } catch { /* best-effort */ }
  }

  // Quality scoring (best-effort)
  if (rootNodeId) {
    try {
      tracer.enter('scoreNodes()', 'qualityScorer.ts');
      const report = await scoreCreatedNodes([rootNodeId]);
      const qualityStr = formatQualityReport(report);
      if (qualityStr) {
        _stderr = _stderr ? _stderr + '\n' + qualityStr : qualityStr;
      }
      tracer.exit();
    } catch { /* quality scoring is best-effort */ }
  }

  return { data, _stderr, _stages };
}
