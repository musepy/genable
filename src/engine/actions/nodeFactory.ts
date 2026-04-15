/**
 * @file nodeFactory.ts
 * @description Shared Figma node creation and property application.
 *
 * This is the layer closest to the Figma scene graph. All write paths
 * (jsx, edit, run mk) call these functions directly — no intermediate IR.
 *
 * Responsibilities:
 * - Create Figma nodes by type
 * - Apply properties (with ordering, dependency validation, handler dispatch)
 * - Font loading and rich text
 * - Component registry (cross-session persistence)
 * - Sizing normalization, viewport centering
 */

import { fontBus } from '../figma-adapter/resources/FontBus';
import { fetchIconSvg, prefetchIcons } from '../figma-adapter/assets/iconify';
import { lowerPaints } from '../figma/figma-lowering';
import { applyProperty } from './handlers';
import { parseRichText } from '../text/richTextParser';
import { toCamelCase } from '../utils/prop-dsl';
import { sortByPropertyOrder, validateDependencies, SELF_GATE_PROPERTIES, PARENT_GATE_PROPERTIES } from './propertyDependencies';
import { expandShorthands } from './expandShorthands';
import { normalizeSizing, type SizingMode } from '../utils/LayoutValidator';
import type { Warning } from './handlers/types';
import type { StyledRange } from '../text/richTextParser';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface NodeResult {
  nodeId: string;
  warnings: Warning[];
}

export interface PropResult {
  warnings: Warning[];
  diffs: Array<{ key: string; changed: boolean; before?: any; after?: any }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Component Registry (module-level state, persists across tool calls)
// ═══════════════════════════════════════════════════════════════════════════

/** Maps component symbols to real Figma node IDs (cross-batch) */
const componentRegistry = new Map<string, string>();
/** Maps toCamelCase(nodeName) → real Figma ID for name-based instance lookup */
const componentNameRegistry = new Map<string, string>();

export function clearComponentRegistry(): void {
  componentRegistry.clear();
  componentNameRegistry.clear();
}

export function getRegisteredSymbols(): ReadonlySet<string> {
  return new Set(componentRegistry.keys());
}

export function registerComponent(symbol: string, nodeId: string, name?: string): void {
  componentRegistry.set(symbol, nodeId);
  if (name) componentNameRegistry.set(toCamelCase(name), nodeId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Property Application (shared by all paths)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply properties to a SceneNode with shorthand expansion, dependency
 * validation, ordering, and handler dispatch.
 */
export async function applyProps(
  node: SceneNode,
  props: Record<string, any>,
): Promise<PropResult> {
  const warnings: Warning[] = [];
  const diffs: PropResult['diffs'] = [];

  // 1. Expand shorthands (padding, align, fill, layout, etc.)
  const normalizedProps: Record<string, any> = expandShorthands({ ...props });

  // 2. Validate dependencies and auto-fix missing gates
  const nodeState: Record<string, unknown> = {};
  for (const g of SELF_GATE_PROPERTIES) {
    if (g in node) nodeState[g] = (node as any)[g];
  }
  let parentState: Record<string, unknown> | undefined;
  if (node.parent) {
    parentState = {};
    for (const g of PARENT_GATE_PROPERTIES) {
      if (g in node.parent) (parentState as any)[g] = (node.parent as any)[g];
    }
  }
  const { fixes, warnings: depWarnings } = validateDependencies(normalizedProps, nodeState, parentState);
  Object.assign(normalizedProps, fixes);
  for (const w of depWarnings) {
    warnings.push({ code: 'DEPENDENCY_VIOLATION', severity: 'warning', message: w });
  }

  // 3. Sort properties by dependency-derived order
  const sortedEntries = sortByPropertyOrder(Object.entries(normalizedProps));

  // 4. Apply each property via the handler pipeline
  for (const [key, value] of sortedEntries) {
    const result = await applyProperty(node, key, value);
    if (result.warnings.length > 0) warnings.push(...result.warnings);
    diffs.push(result.diff);
  }
  return { warnings, diffs };
}

/**
 * Apply properties to a TextNode — handles font loading, rich text parsing,
 * then delegates remaining props to applyProps().
 */
export async function applyTextProps(
  node: TextNode,
  props: Record<string, any>,
): Promise<PropResult> {
  const warnings: Warning[] = [];
  const diffs: PropResult['diffs'] = [];

  // Handle font resolution before setting characters
  const currentFont = node.fontName as FontName;
  const family = props.fontFamily || currentFont?.family || 'Inter';

  const currentIsItalic = currentFont?.style?.includes('Italic') ?? false;
  const rawWeight = props.fontWeight ?? currentFont?.style?.replace(/\s*Italic\s*/, '').trim() ?? 'Regular';
  const weight = fontBus.normalizeWeight(rawWeight);

  const isItalic = props.fontStyle !== undefined
    ? props.fontStyle === 'italic'
    : currentIsItalic;

  const style = fontBus.buildStyleString(weight, isItalic);

  const { loadedStyle, error } = await fontBus.getOrLoad(family, style);
  if (error && loadedStyle !== style) {
    warnings.push({
      code: 'FONT_FALLBACK',
      severity: 'warning',
      requested: { family, style },
      applied: { family, style: loadedStyle },
      message: `Font not found, applied fallback: ${loadedStyle}`,
    } as any);
  }

  node.fontName = { family, style: loadedStyle };

  // Parse rich text markup (markdown → plain text + ranges)
  if (props.characters !== undefined) {
    const { plainText, ranges } = parseRichText(props.characters);
    node.characters = plainText;

    // Apply base props BEFORE range overrides
    const otherProps = { ...props };
    delete otherProps.fontFamily;
    delete otherProps.fontWeight;
    delete otherProps.fontStyle;
    delete otherProps.fontSlant;
    delete otherProps.characters;

    const propResult = await applyProps(node, otherProps);
    if (propResult.warnings.length > 0) warnings.push(...propResult.warnings);
    diffs.push(...propResult.diffs);

    // Apply style ranges via Figma Range API (after base props)
    for (const range of ranges) {
      try {
        await applyStyledRange(node, range, family);
      } catch (e: any) {
        warnings.push({
          code: 'RANGE_STYLE_FAILED',
          severity: 'warning',
          message: `Failed to apply ${range.style.type} at [${range.start}:${range.end}]: ${e?.message}`,
        });
      }
    }
  } else {
    const otherProps = { ...props };
    delete otherProps.fontFamily;
    delete otherProps.fontWeight;
    delete otherProps.fontStyle;
    delete otherProps.fontSlant;

    const propResult = await applyProps(node, otherProps);
    if (propResult.warnings.length > 0) warnings.push(...propResult.warnings);
    diffs.push(...propResult.diffs);
  }

  return { warnings, diffs };
}

/** Apply a single styled range to a TextNode using Figma Range API. */
async function applyStyledRange(
  node: TextNode,
  range: StyledRange,
  baseFamily: string,
): Promise<void> {
  const { start, end, style } = range;

  switch (style.type) {
    case 'bold': {
      const { loadedStyle } = await fontBus.getOrLoad(baseFamily, 'Bold');
      node.setRangeFontName(start, end, { family: baseFamily, style: loadedStyle });
      break;
    }
    case 'italic': {
      const { loadedStyle } = await fontBus.getOrLoad(baseFamily, 'Italic');
      node.setRangeFontName(start, end, { family: baseFamily, style: loadedStyle });
      break;
    }
    case 'boldItalic': {
      const { loadedStyle } = await fontBus.getOrLoad(baseFamily, 'Bold Italic');
      node.setRangeFontName(start, end, { family: baseFamily, style: loadedStyle });
      break;
    }
    case 'strikethrough':
      node.setRangeTextDecoration(start, end, 'STRIKETHROUGH' as TextDecoration);
      break;
    case 'color': {
      const hex = style.value.replace('#', '');
      const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
      const color = {
        r: parseInt(full.substring(0, 2), 16) / 255,
        g: parseInt(full.substring(2, 4), 16) / 255,
        b: parseInt(full.substring(4, 6), 16) / 255,
      };
      node.setRangeFills(start, end, [{ type: 'SOLID', color }]);
      break;
    }
    case 'size':
      node.setRangeFontSize(start, end, style.value);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Node Creation
// ═══════════════════════════════════════════════════════════════════════════

/** Denied properties that should never be written to nodes. */
const DENIED_PROPS = new Set(['id', 'parent', 'removed', 'type', 'children', 'masterComponent', 'mainComponent']);

function stripDenied(props: Record<string, any>): Record<string, any> {
  const clean = { ...props };
  for (const k of DENIED_PROPS) delete clean[k];
  return clean;
}

/**
 * Create a Frame node, apply props, append to parent.
 * Clears default white fill — "no fill specified" truly means no fill.
 */
export async function createFrame(
  parent: SceneNode | null,
  props: Record<string, any>,
): Promise<NodeResult> {
  const frame = figma.createFrame();
  frame.fills = [];
  if (parent && 'appendChild' in parent) parent.appendChild(frame);
  try {
    const { warnings } = await applyProps(frame, stripDenied(props));
    return { nodeId: frame.id, warnings };
  } catch (e) {
    frame.remove();
    throw e;
  }
}

/**
 * Create a Text node, apply text-specific props, append to parent.
 */
export async function createText(
  parent: SceneNode | null,
  props: Record<string, any>,
): Promise<NodeResult> {
  const text = figma.createText();
  if (parent && 'appendChild' in parent) parent.appendChild(text);
  try {
    const fullProps = { characters: '', ...stripDenied(props) };
    const { warnings } = await applyTextProps(text, fullProps);
    return { nodeId: text.id, warnings };
  } catch (e) {
    text.remove();
    throw e;
  }
}

/**
 * Create a shape node (RECTANGLE, ELLIPSE, LINE, VECTOR), apply props.
 */
export async function createShape(
  shapeType: string,
  parent: SceneNode | null,
  props: Record<string, any>,
): Promise<NodeResult> {
  let shape: SceneNode;
  if (shapeType === 'ELLIPSE') shape = figma.createEllipse();
  else if (shapeType === 'LINE') shape = figma.createLine();
  else if (shapeType === 'VECTOR') shape = figma.createVector();
  else shape = figma.createRectangle();

  if (parent && 'appendChild' in parent) parent.appendChild(shape);
  try {
    const { warnings } = await applyProps(shape, stripDenied(props));
    return { nodeId: shape.id, warnings };
  } catch (e) {
    shape.remove();
    throw e;
  }
}

/**
 * Create an icon from SVG, apply props with vector tinting.
 */
export async function createIcon(
  parent: SceneNode | null,
  props: Record<string, any>,
): Promise<NodeResult> {
  const iconWarnings: Warning[] = [];
  let svgData = props.svgData;
  if (!svgData && props.iconName) {
    const fetched = await fetchIconSvg(props.iconName);
    if (fetched) {
      svgData = fetched;
    } else {
      iconWarnings.push({
        code: 'ICON_FETCH_FAILED',
        severity: 'warning',
        message: `Icon "${props.iconName}" could not be loaded. Use "prefix:name" format (e.g. "lucide:home", "mdi:star"). Rendered as empty placeholder.`,
        iconName: props.iconName,
      } as any);
    }
  }

  const iconParam = svgData || `<svg width="${props.width || 24}" height="${props.height || 24}"></svg>`;
  const iconNode = figma.createNodeFromSvg(iconParam);
  if (parent && 'appendChild' in parent) parent.appendChild(iconNode);

  try {
    // Rescale SVG proportionally
    const targetW = props.width || 24;
    const targetH = props.height || 24;
    const origW = iconNode.width;
    const origH = iconNode.height;
    if (origW > 0 && origH > 0) {
      const scale = Math.min(targetW / origW, targetH / origH);
      iconNode.rescale(scale);
    }

    // Separate vector-specific props from frame props
    const iconFills = props.fills;
    const iconStrokes = props.strokes;
    const iconStrokeWeight = props.strokeWeight;
    const propsForFrame = { ...stripDenied(props) };
    delete propsForFrame.fills;
    delete propsForFrame.strokes;
    delete propsForFrame.strokeWeight;
    delete propsForFrame.width;
    delete propsForFrame.height;
    delete propsForFrame.iconName;
    delete propsForFrame.svgData;

    const { warnings } = await applyProps(iconNode, propsForFrame);

    // Tint vector children
    if (iconFills || iconStrokes || iconStrokeWeight !== undefined) {
      const tintColor = iconFills ? lowerPaints(iconFills) : undefined;
      const explicitStrokes = iconStrokes ? lowerPaints(iconStrokes) : undefined;
      for (const child of iconNode.findAll()) {
        if ('fills' in child && 'strokes' in child) {
          const childFills = (child as any).fills as readonly Paint[];
          const childStrokes = (child as any).strokes as readonly Paint[];

          if (explicitStrokes) {
            (child as any).strokes = explicitStrokes;
          } else if (tintColor && Array.isArray(childStrokes) && childStrokes.length > 0) {
            (child as any).strokes = tintColor;
          }

          if (tintColor && Array.isArray(childFills) && childFills.length > 0) {
            (child as any).fills = tintColor;
          }
        }
        if (iconStrokeWeight !== undefined && 'strokeWeight' in child) {
          (child as any).strokeWeight = iconStrokeWeight;
        }
      }
    }

    return { nodeId: iconNode.id, warnings: [...iconWarnings, ...warnings] };
  } catch (e) {
    iconNode.remove();
    throw e;
  }
}

/**
 * Create a Component node, register it in the component registry.
 */
export async function createComponent(
  parent: SceneNode | null,
  props: Record<string, any>,
  symbol?: string,
): Promise<NodeResult> {
  const comp = figma.createComponent();
  comp.fills = [];
  if (parent && 'appendChild' in parent) parent.appendChild(comp);
  try {
    const { warnings } = await applyProps(comp, stripDenied(props));
    if (symbol) registerComponent(symbol, comp.id, comp.name);
    else if (comp.name) componentNameRegistry.set(toCamelCase(comp.name), comp.id);
    return { nodeId: comp.id, warnings };
  } catch (e) {
    comp.remove();
    throw e;
  }
}

/**
 * Resolve a component reference to a ComponentNode.
 * Resolution chain: symbolMap → componentRegistry → componentNameRegistry → raw ID → page search.
 */
export async function resolveComponent(
  ref: string,
  symbolMap?: Map<string, string>,
  variant?: string,
): Promise<ComponentNode | null> {
  // Try symbolMap first (current batch)
  const fromSymbol = symbolMap?.get(ref);
  const candidateId = fromSymbol
    || componentRegistry.get(ref)
    || componentNameRegistry.get(ref)
    || componentNameRegistry.get(toCamelCase(ref))
    || ref;

  const node = await figma.getNodeByIdAsync(candidateId);
  if (node && node.type === 'COMPONENT') return node as ComponentNode;
  if (node && node.type === 'COMPONENT_SET') {
    const cs = node as ComponentSetNode;
    if (variant) {
      const exact = cs.children.find(c => c.type === 'COMPONENT' && c.name === variant);
      if (exact) return exact as ComponentNode;
      const partial = cs.children.find(c => c.type === 'COMPONENT' && c.name.includes(variant));
      if (partial) return partial as ComponentNode;
    }
    return cs.defaultVariant as ComponentNode;
  }

  // Fallback: search current page by name
  const nameLower = ref.toLowerCase();
  const found = figma.currentPage.findOne(n =>
    (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') &&
    n.name.toLowerCase() === nameLower,
  );
  if (found) {
    if (found.type === 'COMPONENT') return found as ComponentNode;
    if (found.type === 'COMPONENT_SET') {
      const cs = found as ComponentSetNode;
      if (variant) {
        const exact = cs.children.find(c => c.type === 'COMPONENT' && c.name === variant);
        if (exact) return exact as ComponentNode;
        const partial = cs.children.find(c => c.type === 'COMPONENT' && c.name.includes(variant));
        if (partial) return partial as ComponentNode;
      }
      return cs.defaultVariant as ComponentNode;
    }
  }
  return null;
}

/**
 * Create a component instance, apply props and child overrides.
 */
export async function createInstance(
  compRef: string,
  parent: SceneNode | null,
  props?: Record<string, any>,
  overrides?: Record<string, Record<string, any>>,
  symbolMap?: Map<string, string>,
  variant?: string,
): Promise<NodeResult> {
  const master = await resolveComponent(compRef, symbolMap, variant);
  if (!master) {
    return { nodeId: '', warnings: [{ code: 'COMPONENT_NOT_FOUND', severity: 'error' as any, message: `Component "${compRef}" not found` }] };
  }

  const instance = master.createInstance();
  if (parent && 'appendChild' in parent) parent.appendChild(instance);
  const warnings: Warning[] = [];

  if (props && Object.keys(props).length > 0) {
    try {
      const pw = await applyProps(instance, stripDenied(props));
      warnings.push(...pw.warnings);
    } catch (e: any) {
      instance.remove();
      throw e;
    }
  }

  // Apply overrides: find children by name and apply props
  if (overrides) {
    for (const [childName, overrideProps] of Object.entries(overrides)) {
      const child = instance.findOne(n => n.name === childName);
      if (child) {
        try {
          if (child.type === 'TEXT') {
            const tw = await applyTextProps(child as TextNode, overrideProps);
            warnings.push(...tw.warnings);
          } else {
            const pw = await applyProps(child, overrideProps);
            warnings.push(...pw.warnings);
          }
        } catch (e: any) {
          warnings.push({ code: 'OVERRIDE_FAILED', severity: 'warning', message: `Override for '${childName}' failed: ${e.message}` });
        }
      }
    }
  }

  return { nodeId: instance.id, warnings };
}

/**
 * Create a ComponentSet from existing component nodes.
 */
export async function createComponentSet(
  componentIds: string[],
  parent: SceneNode | null,
  props: Record<string, any>,
  symbol?: string,
  symbolMap?: Map<string, string>,
): Promise<NodeResult> {
  const components: ComponentNode[] = [];
  for (const compId of componentIds) {
    const resolvedId = symbolMap?.get(compId) || componentRegistry.get(compId) || compId;
    const node = await figma.getNodeByIdAsync(resolvedId);
    if (node && node.type === 'COMPONENT') {
      components.push(node as ComponentNode);
    } else {
      return { nodeId: '', warnings: [{ code: 'COMPONENT_NOT_FOUND', severity: 'error' as any, message: `Component "${compId}" not found or not a COMPONENT (resolved to ${resolvedId})` }] };
    }
  }
  if (components.length < 2) {
    return { nodeId: '', warnings: [{ code: 'INSUFFICIENT_COMPONENTS', severity: 'error' as any, message: `variantSet requires at least 2 components, got ${components.length}` }] };
  }

  const setParent = parent || figma.currentPage;
  const componentSet = figma.combineAsVariants(components, setParent as BaseNode & ChildrenMixin);
  const propsWithLayout = { layoutMode: 'HORIZONTAL', ...stripDenied(props) };
  const { warnings } = await applyProps(componentSet, propsWithLayout);
  if (symbol) registerComponent(symbol, componentSet.id, componentSet.name);
  else if (componentSet.name) componentNameRegistry.set(toCamelCase(componentSet.name), componentSet.id);
  return { nodeId: componentSet.id, warnings };
}

/**
 * Clone a node, apply prop/child overrides.
 */
export async function cloneNode(
  sourceId: string,
  parent: SceneNode | null,
  props?: Record<string, any>,
  overrides?: Record<string, Record<string, any>>,
  symbolMap?: Map<string, string>,
): Promise<NodeResult> {
  const resolvedId = symbolMap?.get(sourceId) || componentRegistry.get(sourceId) || sourceId;
  const srcNode = await figma.getNodeByIdAsync(resolvedId);
  if (!srcNode) {
    return { nodeId: '', warnings: [{ code: 'CLONE_SOURCE_NOT_FOUND', severity: 'error' as any, message: `Clone source "${sourceId}" not found (resolved to ${resolvedId})` }] };
  }

  const cloned = (srcNode as any).clone() as SceneNode;
  if (parent && 'appendChild' in parent) parent.appendChild(cloned);
  const warnings: Warning[] = [];

  if (props && Object.keys(props).length > 0) {
    try {
      if (cloned.type === 'TEXT') {
        const tw = await applyTextProps(cloned as TextNode, stripDenied(props));
        warnings.push(...tw.warnings);
      } else {
        const pw = await applyProps(cloned, stripDenied(props));
        warnings.push(...pw.warnings);
      }
    } catch (e: any) {
      cloned.remove();
      throw e;
    }
  }

  // Apply child overrides
  if (overrides && 'findOne' in cloned) {
    for (const [childName, overrideProps] of Object.entries(overrides)) {
      const child = (cloned as FrameNode).findOne(n => n.name === childName);
      if (child) {
        try {
          if (child.type === 'TEXT') {
            const tw = await applyTextProps(child as TextNode, overrideProps);
            warnings.push(...tw.warnings);
          } else {
            const pw = await applyProps(child, overrideProps);
            warnings.push(...pw.warnings);
            // Propagate fills/strokes to vector descendants (icon-like frames)
            if (child.type === 'FRAME' && 'findAll' in child && (overrideProps.fills || overrideProps.strokes)) {
              const vectors = (child as FrameNode).findAll(n => 'fills' in n && 'strokes' in n);
              for (const vec of vectors) {
                if (overrideProps.strokes) (vec as any).strokes = overrideProps.strokes;
                if (overrideProps.fills) (vec as any).fills = overrideProps.fills;
              }
            }
          }
        } catch (e: any) {
          warnings.push({ code: 'CLONE_OVERRIDE_FAILED', severity: 'warning', message: `Override for '${childName}' failed: ${e.message}` });
        }
      }
    }
  }

  // If source was a Component, register clone
  if (cloned.type === 'COMPONENT') {
    componentNameRegistry.set(toCamelCase(cloned.name), cloned.id);
  }

  return { nodeId: cloned.id, warnings };
}

/**
 * Update an existing node's properties.
 */
export async function updateNode(
  node: SceneNode,
  props: Record<string, any>,
): Promise<NodeResult> {
  const { warnings } = node.type === 'TEXT'
    ? await applyTextProps(node as TextNode, stripDenied(props))
    : await applyProps(node, stripDenied(props));
  return { nodeId: node.id, warnings };
}

/**
 * Delete a node. Returns ownership warning if not agent-created.
 */
export function deleteNode(node: SceneNode): NodeResult {
  const warnings: Warning[] = [];
  if (!isAgentOwned(node)) {
    warnings.push({ code: 'NOT_AGENT_OWNED', severity: 'warning', message: `Deleting '${node.name}' (${node.id}) — not created by agent.` });
  }
  if (!node.removed) node.remove();
  return { nodeId: node.id, warnings };
}

/**
 * Tag a node as agent-created (for ownership checks).
 */
export function tagAsAgentCreated(node: SceneNode): void {
  try { node.setPluginData('_agent', 'created'); } catch { /* best-effort */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Check if a node (or any ancestor) was created by the agent. */
export function isAgentOwned(node: SceneNode): boolean {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if ('getPluginData' in current && (current as SceneNode).getPluginData('_agent') === 'created') {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Pre-normalize sizing props to prevent Figma API exceptions.
 */
export function normalizeSizingInProps(
  props: Record<string, any>,
  targetNode: SceneNode | null,
  parentNode: SceneNode | null,
  isText?: boolean,
): Warning[] {
  if (props.layoutSizingHorizontal === undefined && props.layoutSizingVertical === undefined) {
    return [];
  }
  if (isText) return [];

  const warnings: Warning[] = [];

  const nodeLayoutMode = props.layoutMode ?? (targetNode as any)?.layoutMode;
  const hasAutoLayout = nodeLayoutMode === 'HORIZONTAL' || nodeLayoutMode === 'VERTICAL';
  const parentLayoutMode =
    parentNode && 'layoutMode' in (parentNode as any)
      ? (parentNode as any).layoutMode
      : undefined;
  const parentHasAutoLayout = parentLayoutMode === 'HORIZONTAL' || parentLayoutMode === 'VERTICAL';
  const isRoot = !parentNode || (parentNode as any).type === 'PAGE';

  const toSizingMode = (v: unknown): SizingMode =>
    (v === 'HUG' || v === 'FILL' || v === 'FIXED') ? v : 'FIXED';

  const currentH = toSizingMode(
    props.layoutSizingHorizontal ?? (targetNode as any)?.layoutSizingHorizontal,
  );
  const currentV = toSizingMode(
    props.layoutSizingVertical ?? (targetNode as any)?.layoutSizingVertical,
  );

  const { h, v } = normalizeSizing(currentH, currentV, {
    hasAutoLayout,
    parentHasAutoLayout,
    isRoot,
  });

  if (props.layoutSizingHorizontal !== undefined) props.layoutSizingHorizontal = h;
  if (props.layoutSizingVertical !== undefined) props.layoutSizingVertical = v;

  if (h === 'FIXED' && currentH !== 'FIXED' && props.width === undefined) {
    const fallbackWidth = Math.max(1, Math.round(
      (targetNode as any)?.width ??
        ((parentNode as any)?.type !== 'PAGE' ? (parentNode as any)?.width : undefined) ??
        (isRoot ? 360 : 200),
    ));
    props.width = fallbackWidth;
    warnings.push({ code: 'SIZING_NORMALIZED', severity: 'warning', message: `layoutSizingHorizontal ${currentH}→FIXED; width defaulted to ${fallbackWidth}px.` });
  }

  if (v === 'FIXED' && currentV !== 'FIXED' && props.height === undefined) {
    const fallbackHeight = Math.max(1, Math.round(
      (targetNode as any)?.height ??
        ((parentNode as any)?.type !== 'PAGE' ? (parentNode as any)?.height : undefined) ??
        (isRoot ? 240 : 120),
    ));
    props.height = fallbackHeight;
    warnings.push({ code: 'SIZING_NORMALIZED', severity: 'warning', message: `layoutSizingVertical ${currentV}→FIXED; height defaulted to ${fallbackHeight}px.` });
  }

  return warnings;
}

/**
 * Center a root-level node in the viewport, avoiding overlap with existing nodes.
 */
export function centerNodeInViewport(props: Record<string, any>, isText: boolean): Record<string, any> {
  const p = { ...props };
  if (p.x === undefined && p.y === undefined) {
    const defaultSize = isText ? 0 : 100;
    const w = p.width ?? defaultSize;
    const h = p.height ?? defaultSize;

    if (typeof figma !== 'undefined' && figma.viewport) {
      const vp = figma.viewport.bounds;
      const vpCx = vp.x + vp.width / 2;
      const vpCy = vp.y + vp.height / 2;
      const GAP = 100;

      const candX = Math.round(vpCx - w / 2);
      const candY = Math.round(vpCy - h / 2);

      const topChildren = figma.currentPage.children;
      const margin = GAP / 2;
      let overlaps = false;
      for (const child of topChildren) {
        if ('x' in child && 'width' in child && 'y' in child && 'height' in child) {
          const cx = (child as any).x, cy = (child as any).y;
          const cw = (child as any).width, ch = (child as any).height;
          if (candX < cx + cw + margin && candX + w > cx - margin &&
              candY < cy + ch + margin && candY + h > cy - margin) {
            overlaps = true;
            break;
          }
        }
      }

      if (!overlaps) {
        p.x = candX;
        p.y = candY;
      } else {
        let maxRight = -Infinity;
        for (const child of topChildren) {
          if ('x' in child && 'width' in child && 'y' in child && 'height' in child) {
            const cy = (child as any).y, ch = (child as any).height;
            if (cy < vp.y + vp.height && cy + ch > vp.y) {
              const right = (child as any).x + (child as any).width;
              if (right > maxRight) maxRight = right;
            }
          }
        }
        p.x = maxRight > -Infinity
          ? Math.round(maxRight + GAP)
          : Math.round(vp.x + vp.width + GAP);
        p.y = Math.round(vpCy - h / 2);
      }
    }
  }
  return p;
}

/** Prefetch icons in parallel before serial node creation. */
export { prefetchIcons };

/**
 * Find existing child by name+type under parent (for upsert support).
 */
export function findExistingChild(
  parent: SceneNode | null,
  name: string | undefined,
  expectedType: string,
): SceneNode | null {
  if (!parent || !name || !('children' in parent)) return null;
  const children = (parent as any).children as readonly SceneNode[];
  return children.find(
    (c: SceneNode) => c.name === name && c.type === expectedType,
  ) ?? null;
}

/**
 * Resolve a parent node by ID. Returns null for page root.
 */
export async function resolveParent(parentId?: string): Promise<SceneNode | null> {
  if (!parentId || parentId === 'root') return null;
  const node = await figma.getNodeByIdAsync(parentId);
  return node as SceneNode | null;
}
