/**
 * Prompt Quality Evaluator — the "val_bpb" of prompt engineering.
 *
 * Parses dev bridge results (tree.json + meta.json) and computes
 * a single quality score (0-100) from multiple dimensions.
 *
 * Usage:
 *   npx tsx tools/autoresearch/evaluate.ts /tmp/figma-bridge/results/trigger-xxx
 *   npx tsx tools/autoresearch/evaluate.ts  # evaluates latest result
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────

interface SerializedNode {
  id: string;
  type: string;
  name: string;
  visible: boolean;
  width: number;
  height: number;
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  fills?: any[];
  strokes?: any[];
  cornerRadius?: number;
  effects?: any[];
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string };
  textAutoResize?: string;
  children?: SerializedNode[];
}

interface ToolCallDetail {
  name: string;
  status: string;
  durationMs?: number;
  params: string;
  result: string;
  error?: string;
}

interface Meta {
  triggerId: string;
  status: string;
  finalText: string;
  durationMs: number;
  modelName: string;
  toolCallSummary: { total: number; errors: number };
  toolCallDetails: ToolCallDetail[];
}

export interface EvalMetrics {
  // Layout completeness (0-1): frames with align properties should have layoutMode
  layoutCompleteness: number;
  // Fill completeness (0-1): visible non-text leaf nodes should have fills
  fillCompleteness: number;
  // Text completeness (0-1): TEXT nodes should have fontSize + fontName
  textCompleteness: number;
  // Sizing completeness (0-1): frames with layoutMode should have sizing modes
  sizingCompleteness: number;
  // Spacing completeness (0-1): frames with children should have padding/spacing
  spacingCompleteness: number;
  // Tool efficiency (0-1): fewer tool calls relative to node count = better
  toolEfficiency: number;
  // Error rate (0-1): 1 = no errors, 0 = all errors
  errorFreeRate: number;
  // Node count: total visible nodes created
  nodeCount: number;
  // Hierarchy depth: max nesting level
  maxDepth: number;
  // Duration in seconds
  durationSec: number;
}

export interface EvalResult {
  triggerId: string;
  model: string;
  metrics: EvalMetrics;
  score: number; // 0-100 composite
  issues: string[]; // Human-readable issues found
}

// ─── Reconstruct nodes from mk tool calls ───────────────────────

/** Parse JSX markup into synthetic SerializedNode tree. */
function buildNodesFromJsx(markup: string): SerializedNode[] {
  // Lightweight JSX parser for the evaluator fallback — extract tags, attrs, nesting
  const roots: SerializedNode[] = [];
  const stack: SerializedNode[] = [];
  let idCounter = 0;

  // Simple regex-based tokenizer (sufficient for evaluator — not the full parser)
  let pos = 0;
  while (pos < markup.length) {
    // Skip whitespace
    while (pos < markup.length && /\s/.test(markup[pos])) pos++;
    if (pos >= markup.length) break;

    // Match opening/self-closing tag: <tag attrs... /> or <tag attrs...>
    if (markup[pos] === '<' && markup[pos + 1] !== '/') {
      const tagMatch = markup.slice(pos).match(/^<(\w+)((?:\s+[\w.$:-]+(?:=(?:\{[^}]*\}|"[^"]*"|'[^']*'|\S+))?)*)\s*(\/?)>/);
      if (!tagMatch) { pos++; continue; }
      const [fullMatch, tag, attrsStr, selfClosing] = tagMatch;
      pos += fullMatch.length;

      // Parse attributes
      const props: Record<string, string> = {};
      let name = '';
      const attrRegex = /([\w.$:-]+)=(?:\{([^}]*)\}|"([^"]*)"|'([^']*)'|(\S+))/g;
      let am;
      while ((am = attrRegex.exec(attrsStr)) !== null) {
        const key = am[1];
        const val = am[2] ?? am[3] ?? am[4] ?? am[5] ?? '';
        if (key === 'name') { name = val; continue; }
        props[key] = val;
      }

      // Determine node type
      const VALID_TYPES = new Set(['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'group', 'section', 'vector', 'component', 'instance']);
      const effectiveTag = VALID_TYPES.has(tag) ? tag : 'frame';
      let nodeType = effectiveTag === 'text' ? 'TEXT' : effectiveTag === 'rect' ? 'RECTANGLE' :
        effectiveTag === 'ellipse' ? 'ELLIPSE' : effectiveTag === 'line' ? 'LINE' : 'FRAME';

      const node: SerializedNode = {
        id: `jsx-${++idCounter}`,
        type: nodeType,
        name: name || tag,
        visible: true,
        width: 100, height: 100,
      };

      // Map props (same as mk handler)
      if (props.layout) node.layoutMode = props.layout === 'row' ? 'HORIZONTAL' : props.layout === 'column' ? 'VERTICAL' : props.layout;
      if (props.w) {
        if (props.w === 'fill') node.layoutSizingHorizontal = 'FILL';
        else if (props.w === 'hug') node.layoutSizingHorizontal = 'HUG';
        else { node.layoutSizingHorizontal = 'FIXED'; node.width = parseFloat(props.w) || 100; }
      }
      if (props.h) {
        if (props.h === 'fill') node.layoutSizingVertical = 'FILL';
        else if (props.h === 'hug') node.layoutSizingVertical = 'HUG';
        else { node.layoutSizingVertical = 'FIXED'; node.height = parseFloat(props.h) || 100; }
      }
      if (props.gap) node.itemSpacing = parseFloat(props.gap) || 0;
      if (props.p) {
        const pVal = parseFloat(props.p) || 0;
        node.paddingTop = pVal; node.paddingRight = pVal; node.paddingBottom = pVal; node.paddingLeft = pVal;
      }
      if (props.bg && props.bg !== 'transparent') node.fills = [{ type: 'SOLID', visible: true }];
      if (props.corner) node.cornerRadius = props.corner === 'full' ? 999 : parseFloat(props.corner) || 0;
      if (node.layoutMode && node.layoutMode !== 'NONE') {
        if (!node.layoutSizingHorizontal) node.layoutSizingHorizontal = 'HUG';
        if (!node.layoutSizingVertical) node.layoutSizingVertical = 'HUG';
      }
      if (nodeType === 'TEXT') {
        if (props.size) node.fontSize = parseFloat(props.size);
        if (props.weight) node.fontName = { family: 'Inter', style: props.weight };
        else node.fontName = { family: 'Inter', style: 'Regular' };
        if (props.fill) node.fills = [{ type: 'SOLID', visible: true }];
        node.textAutoResize = props.w === 'fill' ? 'HEIGHT' : 'WIDTH_AND_HEIGHT';
        // Capture text content after tag until </text>
        // Skip past the closing tag entirely — TEXT nodes are NOT pushed to the stack,
        // so we must not let the closing-tag handler run (it would pop the parent frame).
        const closeIdx = markup.indexOf(`</${tag}>`, pos);
        if (closeIdx >= 0) {
          const textContent = markup.slice(pos, closeIdx).trim();
          if (textContent) node.characters = textContent;
          pos = closeIdx + tag.length + 3; // skip past "</text>"
        }
      }

      // Parent linkage via stack
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }

      if (!selfClosing && nodeType !== 'TEXT') {
        stack.push(node);
      }
    }
    // Closing tag: </tag>
    else if (markup[pos] === '<' && markup[pos + 1] === '/') {
      const closeMatch = markup.slice(pos).match(/^<\/\w+>/);
      pos += closeMatch ? closeMatch[0].length : 1;
      stack.pop();
    }
    else {
      pos++;
    }
  }

  return roots;
}

/** Parse create() tool call nodes into synthetic SerializedNode tree. */
function buildNodesFromCreateNodes(nodes: any[]): SerializedNode[] {
  const roots: SerializedNode[] = [];
  const nameToNode = new Map<string, SerializedNode>();
  let idCounter = 0;

  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const tag = n.tag || 'frame';
    const name = n.name || tag;

    let nodeType = tag === 'text' ? 'TEXT' : tag === 'rect' ? 'RECTANGLE' :
      tag === 'ellipse' ? 'ELLIPSE' : tag === 'line' ? 'LINE' : 'FRAME';

    const node: SerializedNode = {
      id: `create-${++idCounter}`,
      type: nodeType,
      name,
      visible: true,
      width: 100, height: 100,
    };

    // Map props (same logic as mk/jsx handlers)
    if (n.layout) node.layoutMode = n.layout === 'row' ? 'HORIZONTAL' : n.layout === 'column' ? 'VERTICAL' : n.layout;
    if (n.w) {
      if (n.w === 'fill') node.layoutSizingHorizontal = 'FILL';
      else if (n.w === 'hug') node.layoutSizingHorizontal = 'HUG';
      else { node.layoutSizingHorizontal = 'FIXED'; node.width = parseFloat(n.w) || 100; }
    }
    if (n.h) {
      if (n.h === 'fill') node.layoutSizingVertical = 'FILL';
      else if (n.h === 'hug') node.layoutSizingVertical = 'HUG';
      else { node.layoutSizingVertical = 'FIXED'; node.height = parseFloat(n.h) || 100; }
    }
    if (n.gap != null) node.itemSpacing = parseFloat(n.gap) || 0;
    if (n.p != null) {
      const pVal = parseFloat(n.p) || 0;
      node.paddingTop = pVal; node.paddingRight = pVal; node.paddingBottom = pVal; node.paddingLeft = pVal;
    }
    if (n.bg && n.bg !== 'transparent') node.fills = [{ type: 'SOLID', visible: true }];
    if (n.corner) node.cornerRadius = n.corner === 'full' ? 999 : parseFloat(n.corner) || 0;
    if (node.layoutMode && node.layoutMode !== 'NONE') {
      if (!node.layoutSizingHorizontal) node.layoutSizingHorizontal = 'HUG';
      if (!node.layoutSizingVertical) node.layoutSizingVertical = 'HUG';
    }
    if (nodeType === 'TEXT') {
      if (n.size) node.fontSize = parseFloat(n.size);
      if (n.weight) node.fontName = { family: 'Inter', style: String(n.weight) };
      else node.fontName = { family: 'Inter', style: 'Regular' };
      if (n.fill) node.fills = [{ type: 'SOLID', visible: true }];
      if (n.content) node.characters = String(n.content);
      node.textAutoResize = n.w === 'fill' ? 'HEIGHT' : 'WIDTH_AND_HEIGHT';
    }

    // Parent linkage by name
    if (n.parent && nameToNode.has(n.parent)) {
      const parent = nameToNode.get(n.parent)!;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    nameToNode.set(name, node);
  }

  return roots;
}

/** Parse mk batch lines into synthetic SerializedNode tree. */
function buildNodesFromToolCalls(meta: Meta): SerializedNode[] {
  const nodeMap = new Map<string, SerializedNode>();
  const roots: SerializedNode[] = [];

  for (const tc of (meta.toolCallDetails ?? [])) {
    if (tc.status !== 'success') continue;
    let batchText = '';
    let jsxMarkup = '';
    try {
      const params = JSON.parse(tc.params);
      if (tc.name === 'mk' && params.batch) batchText = params.batch;
      else if (tc.name === 'render' && params.markup) batchText = params.markup;
      else if (tc.name === 'jsx' && params.markup) jsxMarkup = params.markup;
      else if (tc.name === 'create' && Array.isArray(params.nodes)) {
        roots.push(...buildNodesFromCreateNodes(params.nodes));
        continue;
      }
      else continue;
    } catch { continue; }

    // Handle JSX tool calls
    if (jsxMarkup) {
      roots.push(...buildNodesFromJsx(jsxMarkup));
      continue;
    }

    for (const line of batchText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

      // Parse: /path/ [type] key:value... [-- text content]
      const textSep = trimmed.indexOf(' -- ');
      const propPart = textSep >= 0 ? trimmed.slice(0, textSep) : trimmed;
      const textContent = textSep >= 0 ? trimmed.slice(textSep + 4) : undefined;

      // Smart path extraction: paths start with / and may contain spaces.
      // The path ends at the first token that is a known type or contains ':'
      if (!propPart.startsWith('/')) continue;
      const types = new Set(['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'group', 'section', 'vector']);
      const allTokens = propPart.split(/\s+/);
      let pathEndIdx = 1; // at least first token is part of path
      for (let k = 1; k < allTokens.length; k++) {
        const tok = allTokens[k];
        // If it's a known type or has key:value format, path has ended
        if (types.has(tok) || tok.includes(':')) break;
        // If it ends with '/' it's still part of the path (e.g. "Card/" in "/Login Card/")
        pathEndIdx = k + 1;
      }
      const pathToken = allTokens.slice(0, pathEndIdx).join(' ');

      // Extract path segments
      const cleanPath = pathToken.replace(/^\/+|\/+$/g, '');
      const segments = cleanPath.split('/');
      const name = segments[segments.length - 1] || 'unnamed';

      // Detect type
      let nodeType = 'FRAME';
      const restTokens = allTokens.slice(pathEndIdx);
      if (restTokens.length > 0 && types.has(restTokens[0])) {
        const t = restTokens.shift()!;
        nodeType = t === 'text' ? 'TEXT' : t === 'rect' ? 'RECTANGLE' : t === 'icon' ? 'FRAME' : t.toUpperCase();
      }

      // Parse key:value props
      const props: Record<string, string> = {};
      for (const token of restTokens) {
        const colonIdx = token.indexOf(':');
        if (colonIdx > 0) {
          props[token.slice(0, colonIdx)] = token.slice(colonIdx + 1);
        }
      }

      // Build synthetic node
      const node: SerializedNode = {
        id: pathToken,
        type: nodeType,
        name,
        visible: true,
        x: 0, y: 0, width: 100, height: 100,
      };

      // Map mk props to SerializedNode fields
      if (props.layout) {
        node.layoutMode = props.layout === 'row' ? 'HORIZONTAL' : props.layout === 'column' ? 'VERTICAL' : props.layout;
      }
      if (props.w) {
        if (props.w === 'fill') node.layoutSizingHorizontal = 'FILL';
        else if (props.w === 'hug') node.layoutSizingHorizontal = 'HUG';
        else { node.layoutSizingHorizontal = 'FIXED'; node.width = parseFloat(props.w) || 100; }
      }
      if (props.h) {
        if (props.h === 'fill') node.layoutSizingVertical = 'FILL';
        else if (props.h === 'hug') node.layoutSizingVertical = 'HUG';
        else { node.layoutSizingVertical = 'FIXED'; node.height = parseFloat(props.h) || 100; }
      }
      if (props.gap) node.itemSpacing = parseFloat(props.gap) || 0;
      if (props.p) {
        const pVal = parseFloat(props.p) || 0;
        node.paddingTop = pVal; node.paddingRight = pVal; node.paddingBottom = pVal; node.paddingLeft = pVal;
      }
      if (props.px) { const v = parseFloat(props.px) || 0; node.paddingLeft = v; node.paddingRight = v; }
      if (props.py) { const v = parseFloat(props.py) || 0; node.paddingTop = v; node.paddingBottom = v; }
      if (props.bg && props.bg !== 'transparent') node.fills = [{ type: 'SOLID', visible: true }];
      else if (props.bg === 'transparent') node.fills = [{ type: 'SOLID', visible: false }];
      if (props.align) node.primaryAxisAlignItems = props.align.toUpperCase();
      if (props.corner) node.cornerRadius = props.corner === 'full' ? 999 : parseFloat(props.corner) || 0;

      // Auto-layout frames: default sizing to HUG when omitted (Figma behavior)
      if (node.layoutMode && node.layoutMode !== 'NONE') {
        if (!node.layoutSizingHorizontal) node.layoutSizingHorizontal = 'HUG';
        if (!node.layoutSizingVertical) node.layoutSizingVertical = 'HUG';
      }

      // Text props
      if (nodeType === 'TEXT') {
        if (props.size) node.fontSize = parseFloat(props.size);
        if (props.weight) node.fontName = { family: 'Inter', style: props.weight };
        else node.fontName = { family: 'Inter', style: 'Regular' };
        if (props.fill) node.fills = [{ type: 'SOLID', visible: true }];
        if (textContent) node.characters = textContent;
        node.textAutoResize = props.w === 'fill' ? 'HEIGHT' : 'WIDTH_AND_HEIGHT';
      }

      // Build tree by path
      nodeMap.set(cleanPath, node);
      if (segments.length === 1) {
        roots.push(node);
      } else {
        const parentPath = segments.slice(0, -1).join('/');
        const parent = nodeMap.get(parentPath);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.push(node);
        } else {
          roots.push(node); // Orphan — treat as root
        }
      }
    }
  }

  return roots;
}

// ─── Node Tree Traversal ─────────────────────────────────────────

function collectNodes(nodes: SerializedNode[], depth = 0): Array<{ node: SerializedNode; depth: number }> {
  const result: Array<{ node: SerializedNode; depth: number }> = [];
  for (const node of nodes) {
    if (!node.visible) continue;
    result.push({ node, depth });
    if (node.children) {
      result.push(...collectNodes(node.children, depth + 1));
    }
  }
  return result;
}

// ─── Metric Calculators ──────────────────────────────────────────

function calcLayoutCompleteness(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[] } {
  const issues: string[] = [];
  const frames = all.filter(({ node }) =>
    node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE'
  );
  if (frames.length === 0) return { score: 1, issues };

  let complete = 0;
  for (const { node } of frames) {
    const hasLayout = !!node.layoutMode && node.layoutMode !== 'NONE';
    const hasChildren = node.children && node.children.length > 0;

    // Leaf frames (no children) — always pass. Layout is meaningless for them.
    // Covers: icon frames, spacers, decorative elements
    if (!hasChildren) {
      complete++;
    } else if (hasLayout) {
      complete++;
    } else {
      // Frame with children but no layout — penalize
      complete += 0.3;
      issues.push(`Frame "${node.name}" has ${node.children!.length} children but no auto-layout`);
    }
  }
  return { score: complete / frames.length, issues };
}

function calcFillCompleteness(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[] } {
  const issues: string[] = [];
  // Only check container frames (with children) — they should have a visible fill
  // for background. Leaf frames are exempt: icons use vector paths, spacers are invisible.
  const containers = all.filter(({ node }) => {
    if (node.type === 'TEXT' || node.type === 'GROUP') return false;
    const isContainer = node.children && node.children.length > 0;
    return isContainer;
  });
  if (containers.length === 0) return { score: 1, issues };

  let withFill = 0;
  for (const { node } of containers) {
    const hasFill = node.fills && node.fills.length > 0 &&
      node.fills.some((f: any) => f.visible !== false);
    if (hasFill) {
      withFill++;
    } else {
      // Transparent containers are common (layout wrappers) — soft penalty
      withFill += 0.5;
    }
  }
  return { score: withFill / containers.length, issues };
}

function calcTextCompleteness(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[] } {
  const issues: string[] = [];
  const texts = all.filter(({ node }) => node.type === 'TEXT');
  if (texts.length === 0) return { score: 1, issues };

  let complete = 0;
  for (const { node } of texts) {
    let nodeScore = 0;
    let checks = 0;

    // fontSize
    checks++;
    if (node.fontSize && typeof node.fontSize === 'number') nodeScore++;
    else issues.push(`Text "${node.name}" missing explicit fontSize`);

    // fontName
    checks++;
    if (node.fontName && typeof node.fontName === 'object') nodeScore++;

    // characters (not empty)
    checks++;
    if (node.characters && node.characters.trim().length > 0) nodeScore++;

    // textAutoResize (should not be NONE for most text)
    checks++;
    if (node.textAutoResize && node.textAutoResize !== 'NONE') nodeScore++;

    complete += nodeScore / checks;
  }
  return { score: complete / texts.length, issues };
}

function calcSizingCompleteness(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[] } {
  const issues: string[] = [];
  const layoutFrames = all.filter(({ node }) =>
    (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') &&
    node.layoutMode && node.layoutMode !== 'NONE'
  );
  if (layoutFrames.length === 0) return { score: 1, issues };

  let complete = 0;
  for (const { node } of layoutFrames) {
    const hasHSizing = !!node.layoutSizingHorizontal;
    const hasVSizing = !!node.layoutSizingVertical;
    if (hasHSizing && hasVSizing) {
      complete++;
    } else {
      if (!hasHSizing) issues.push(`Frame "${node.name}" missing layoutSizingHorizontal`);
      if (!hasVSizing) issues.push(`Frame "${node.name}" missing layoutSizingVertical`);
      complete += (hasHSizing ? 0.5 : 0) + (hasVSizing ? 0.5 : 0);
    }
  }
  return { score: complete / layoutFrames.length, issues };
}

function calcSpacingCompleteness(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[] } {
  const issues: string[] = [];
  const layoutFrames = all.filter(({ node }) =>
    (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') &&
    node.layoutMode && node.layoutMode !== 'NONE' &&
    node.children && node.children.length > 1
  );
  if (layoutFrames.length === 0) return { score: 1, issues };

  let complete = 0;
  for (const { node } of layoutFrames) {
    let nodeScore = 0;
    let checks = 0;

    // itemSpacing or SPACE_BETWEEN (between children)
    checks++;
    const hasSpaceBetween = node.primaryAxisAlignItems === 'SPACE_BETWEEN';
    if ((node.itemSpacing !== undefined && node.itemSpacing !== null) || hasSpaceBetween) nodeScore++;
    else issues.push(`Frame "${node.name}" missing itemSpacing`);

    // padding — only require for surface frames (those with a visible fill).
    // Wrapper frames (transparent, layout-only) don't need padding.
    const hasFill = node.fills && node.fills.length > 0 &&
      node.fills.some((f: any) => f.visible !== false);
    if (hasFill) {
      checks++;
      const hasPadding = (node.paddingTop || 0) > 0 ||
        (node.paddingRight || 0) > 0 ||
        (node.paddingBottom || 0) > 0 ||
        (node.paddingLeft || 0) > 0;
      if (hasPadding) nodeScore++;
      else issues.push(`Surface frame "${node.name}" has fill but no padding`);
    }
    // Wrapper frames (no fill) — skip padding check entirely

    complete += nodeScore / checks;
  }
  return { score: complete / layoutFrames.length, issues };
}

function calcToolEfficiency(meta: Meta, nodeCount: number): number {
  if (meta.toolCallSummary.total === 0) return 0;
  if (nodeCount === 0) return 0;

  // Ideal: ~1-2 tool calls per node (batch creation)
  // Bad: 5+ tool calls per node (excessive reading/retrying)
  const ratio = meta.toolCallSummary.total / Math.max(nodeCount, 1);
  if (ratio <= 1.5) return 1;
  if (ratio <= 3) return 0.8;
  if (ratio <= 5) return 0.6;
  if (ratio <= 8) return 0.4;
  return 0.2;
}

// ─── Composite Score ─────────────────────────────────────────────

const WEIGHTS = {
  layoutCompleteness: 25,   // Most important: the #1 failure mode
  fillCompleteness: 10,
  textCompleteness: 15,
  sizingCompleteness: 15,
  spacingCompleteness: 15,
  toolEfficiency: 10,
  errorFreeRate: 10,
};

function computeScore(metrics: EvalMetrics): number {
  const raw =
    metrics.layoutCompleteness * WEIGHTS.layoutCompleteness +
    metrics.fillCompleteness * WEIGHTS.fillCompleteness +
    metrics.textCompleteness * WEIGHTS.textCompleteness +
    metrics.sizingCompleteness * WEIGHTS.sizingCompleteness +
    metrics.spacingCompleteness * WEIGHTS.spacingCompleteness +
    metrics.toolEfficiency * WEIGHTS.toolEfficiency +
    metrics.errorFreeRate * WEIGHTS.errorFreeRate;
  return Math.round(raw * 10) / 10;
}

// ─── Main Evaluate Function ─────────────────────────────────────

/** Filter tree to only include subtrees rooted at the given IDs. Falls back to full tree. */
function filterTreeByRootIds(nodes: SerializedNode[], rootIds: string[]): SerializedNode[] {
  if (!rootIds || rootIds.length === 0) return nodes;
  const idSet = new Set(rootIds);
  // Check top-level nodes first
  const matched = nodes.filter(n => idSet.has(n.id));
  if (matched.length > 0) return matched;
  // If root IDs are nested (not top-level), search recursively
  function findInChildren(nodes: SerializedNode[]): SerializedNode[] {
    for (const node of nodes) {
      if (idSet.has(node.id)) return [node];
      if (node.children) {
        const found = findInChildren(node.children);
        if (found.length > 0) return found;
      }
    }
    return [];
  }
  const found = findInChildren(nodes);
  return found.length > 0 ? found : nodes; // Final fallback: full tree
}

export async function evaluate(resultDir: string): Promise<EvalResult> {
  const metaRaw = await readFile(join(resultDir, 'meta.json'), 'utf-8');
  const meta: Meta & { rootNodeIds?: string[] } = JSON.parse(metaRaw);

  let treeNodes: SerializedNode[] = [];

  // Check if agent actually created any design (jsx/mk/create calls)
  const hasCreationCalls = meta.toolCallDetails?.some(tc =>
    tc.status === 'success' && ['jsx', 'mk', 'render', 'design', 'create'].includes(tc.name)
  ) ?? false;
  const rootIds = meta.rootNodeIds || [];

  // Priority 1: tree.json (Figma serialized) — only use if we have rootNodeIds to filter
  try {
    const treeRaw = await readFile(join(resultDir, 'tree.json'), 'utf-8');
    const treeData = JSON.parse(treeRaw);
    const raw = treeData.nodes || [];
    if (rootIds.length > 0) {
      // Filter to current run's roots only
      treeNodes = filterTreeByRootIds(raw, rootIds);
    } else if (!hasCreationCalls) {
      // No creation calls and no rootIds — agent reused existing design, skip full tree
      treeNodes = [];
    } else {
      treeNodes = filterTreeByRootIds(raw, rootIds);
    }
  } catch {
    // Priority 2: nodeTree in meta.json
    if (meta.nodeTree?.nodes?.length) {
      if (rootIds.length > 0) {
        treeNodes = filterTreeByRootIds(meta.nodeTree.nodes, rootIds);
      } else if (!hasCreationCalls) {
        treeNodes = [];
      } else {
        treeNodes = filterTreeByRootIds(meta.nodeTree.nodes, rootIds);
      }
    }
  }

  // Priority 3: Reconstruct from tool call parameters (jsx/mk/create)
  if (treeNodes.length === 0) {
    treeNodes = buildNodesFromToolCalls(meta);
  }

  const allNodes = collectNodes(treeNodes);
  const issues: string[] = [];

  // Compute each metric
  const layout = calcLayoutCompleteness(allNodes);
  const fill = calcFillCompleteness(allNodes);
  const text = calcTextCompleteness(allNodes);
  const sizing = calcSizingCompleteness(allNodes);
  const spacing = calcSpacingCompleteness(allNodes);

  issues.push(...layout.issues, ...fill.issues, ...text.issues, ...sizing.issues, ...spacing.issues);

  const errorFreeRate = meta.toolCallSummary.total > 0
    ? 1 - (meta.toolCallSummary.errors / meta.toolCallSummary.total)
    : 1;

  const maxDepth = allNodes.reduce((max, { depth }) => Math.max(max, depth), 0);

  const metrics: EvalMetrics = {
    layoutCompleteness: layout.score,
    fillCompleteness: fill.score,
    textCompleteness: text.score,
    sizingCompleteness: sizing.score,
    spacingCompleteness: spacing.score,
    toolEfficiency: calcToolEfficiency(meta, allNodes.length),
    errorFreeRate,
    nodeCount: allNodes.length,
    maxDepth,
    durationSec: meta.durationMs / 1000,
  };

  return {
    triggerId: meta.triggerId,
    model: meta.modelName,
    metrics,
    score: computeScore(metrics),
    issues: issues.slice(0, 20), // Cap at 20 issues
  };
}

// ─── CLI ─────────────────────────────────────────────────────────

function formatBar(value: number, width = 20): string {
  const filled = Math.round(value * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function findLatestResult(): Promise<string> {
  const bridgeDir = process.env.BRIDGE_DIR || '/tmp/figma-bridge';
  const resultDir = join(bridgeDir, 'results');
  const entries = await readdir(resultDir);
  if (entries.length === 0) throw new Error('No results found');

  // Sort by modification time, newest first
  const withStats = await Promise.all(
    entries.map(async (name) => {
      const path = join(resultDir, name);
      const s = await import('node:fs/promises').then(fs => fs.stat(path));
      return { name, path, mtime: s.mtimeMs };
    })
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  return withStats[0].path;
}

async function main() {
  const resultDir = process.argv[2] || await findLatestResult();

  console.log(`\nEvaluating: ${resultDir}\n`);

  const result = await evaluate(resultDir);

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log(`║  PROMPT QUALITY SCORE: ${String(result.score).padStart(5)}  / 100               ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Model:    ${result.model.padEnd(40)}  ║`);
  console.log(`║  Nodes:    ${String(result.metrics.nodeCount).padEnd(40)}  ║`);
  console.log(`║  Depth:    ${String(result.metrics.maxDepth).padEnd(40)}  ║`);
  console.log(`║  Duration: ${(result.metrics.durationSec.toFixed(1) + 's').padEnd(40)}  ║`);
  console.log('╠══════════════════════════════════════════════════════╣');

  const dims = [
    ['Layout     ', result.metrics.layoutCompleteness, WEIGHTS.layoutCompleteness],
    ['Text       ', result.metrics.textCompleteness, WEIGHTS.textCompleteness],
    ['Sizing     ', result.metrics.sizingCompleteness, WEIGHTS.sizingCompleteness],
    ['Spacing    ', result.metrics.spacingCompleteness, WEIGHTS.spacingCompleteness],
    ['Fill       ', result.metrics.fillCompleteness, WEIGHTS.fillCompleteness],
    ['Efficiency ', result.metrics.toolEfficiency, WEIGHTS.toolEfficiency],
    ['Error-free ', result.metrics.errorFreeRate, WEIGHTS.errorFreeRate],
  ] as const;

  for (const [label, value, weight] of dims) {
    const pct = (value * 100).toFixed(0).padStart(3);
    const bar = formatBar(value, 15);
    const w = `(w:${weight})`.padEnd(6);
    console.log(`║  ${label} ${bar} ${pct}%  ${w}            ║`);
  }

  console.log('╚══════════════════════════════════════════════════════╝');

  if (result.issues.length > 0) {
    console.log(`\n⚠ Issues (${result.issues.length}):`);
    for (const issue of result.issues.slice(0, 10)) {
      console.log(`  • ${issue}`);
    }
    if (result.issues.length > 10) {
      console.log(`  ... and ${result.issues.length - 10} more`);
    }
  }

  // Output JSON for programmatic use
  if (process.argv.includes('--json')) {
    console.log('\n' + JSON.stringify(result, null, 2));
  }
}

if (process.argv[1]?.includes('evaluate')) {
  main().catch(err => {
    console.error('Evaluate error:', err.message);
    process.exit(1);
  });
}
