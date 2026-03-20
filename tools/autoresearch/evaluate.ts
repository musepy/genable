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

/** Parse mk batch lines into synthetic SerializedNode tree. */
function buildNodesFromToolCalls(meta: Meta): SerializedNode[] {
  const nodeMap = new Map<string, SerializedNode>();
  const roots: SerializedNode[] = [];

  for (const tc of meta.toolCallDetails) {
    if (tc.status !== 'success') continue;
    let batchText = '';
    try {
      const params = JSON.parse(tc.params);
      if (tc.name === 'mk' && params.batch) batchText = params.batch;
      else if (tc.name === 'render' && params.markup) batchText = params.markup;
      else continue;
    } catch { continue; }

    for (const line of batchText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

      // Parse: /path/ [type] key:value... [-- text content]
      const textSep = trimmed.indexOf(' -- ');
      const propPart = textSep >= 0 ? trimmed.slice(0, textSep) : trimmed;
      const textContent = textSep >= 0 ? trimmed.slice(textSep + 4) : undefined;

      const tokens = propPart.split(/\s+/);
      const pathToken = tokens[0];
      if (!pathToken?.startsWith('/')) continue;

      // Extract path segments
      const cleanPath = pathToken.replace(/^\/+|\/+$/g, '');
      const segments = cleanPath.split('/');
      const name = segments[segments.length - 1] || 'unnamed';

      // Detect type
      const types = new Set(['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'group', 'section', 'vector']);
      let nodeType = 'FRAME';
      const restTokens = tokens.slice(1);
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

    // itemSpacing (between children)
    checks++;
    if (node.itemSpacing !== undefined && node.itemSpacing !== null) nodeScore++;
    else issues.push(`Frame "${node.name}" missing itemSpacing`);

    // padding (at least one side > 0 for container frames)
    checks++;
    const hasPadding = (node.paddingTop || 0) > 0 ||
      (node.paddingRight || 0) > 0 ||
      (node.paddingBottom || 0) > 0 ||
      (node.paddingLeft || 0) > 0;
    if (hasPadding) nodeScore++;
    // Not having padding is not always an issue, so softer penalty

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

  // Priority 1: tree.json (Figma serialized)
  try {
    const treeRaw = await readFile(join(resultDir, 'tree.json'), 'utf-8');
    const treeData = JSON.parse(treeRaw);
    const raw = treeData.nodes || [];
    // Filter to current run's roots if available
    treeNodes = filterTreeByRootIds(raw, meta.rootNodeIds || []);
  } catch {
    // Priority 2: nodeTree in meta.json
    if (meta.nodeTree?.nodes?.length) {
      treeNodes = filterTreeByRootIds(meta.nodeTree.nodes, meta.rootNodeIds || []);
    }
  }

  // Priority 3: Reconstruct from mk tool call parameters
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
