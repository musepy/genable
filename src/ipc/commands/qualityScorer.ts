/**
 * @file qualityScorer.ts
 * @description In-loop quality scorer — 6 dimensions scored from live Figma nodes.
 *
 * Runs on the main thread after jsx/create and on inspect.
 * Returns dimensional scores + actionable issues for the agent to fix.
 * Agent loops until all dimensions reach 100%.
 *
 * Dimensions (ported from designQuality.ts, adapted for live Figma API):
 *   1. spacing       — layout frames with 2+ children must have gap or SPACE_BETWEEN
 *   2. padding       — surface frames (visible fill) must have padding
 *   3. hierarchy     — depth 2-5, semantic names, balanced branching
 *   4. spacingGrid   — spacing values on 4px grid (4,8,12,16,20,24,32,48)
 *   5. typography    — 3-5 font sizes, 2-3 weights, clear heading/body ratio
 *   6. layoutCoverage — frames with children should use auto-layout
 */

interface QualityIssue {
  nodeId: string;
  nodeName: string;
  dimension: string;
  message: string;
  fix: string;
}

interface QualityReport {
  spacing: number;
  padding: number;
  hierarchy: number;
  spacingGrid: number;
  typography: number;
  layoutCoverage: number;
  overall: number;
  issues: QualityIssue[];
}

// ─── Collector: walk tree once, collect all data ─────────────────

interface TreeData {
  frames: FrameNode[];
  texts: TextNode[];
  allNodes: SceneNode[];
  maxDepth: number;
}

function collectTreeData(root: SceneNode): TreeData {
  const frames: FrameNode[] = [];
  const texts: TextNode[] = [];
  const allNodes: SceneNode[] = [];
  let maxDepth = 0;

  function walk(node: SceneNode, depth: number): void {
    if (!node.visible) return;
    allNodes.push(node);
    maxDepth = Math.max(maxDepth, depth);

    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      frames.push(node as FrameNode);
      for (const child of (node as FrameNode).children) {
        walk(child, depth + 1);
      }
    } else if (node.type === 'TEXT') {
      texts.push(node as TextNode);
    } else if ('children' in node) {
      for (const child of (node as any).children) {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return { frames, texts, allNodes, maxDepth };
}

// ─── Dimension 1: Spacing ────────────────────────────────────────

function scoreSpacing(data: TreeData, issues: QualityIssue[]): number {
  let total = 0;
  let pass = 0;

  for (const frame of data.frames) {
    const hasLayout = frame.layoutMode && frame.layoutMode !== 'NONE';
    const childCount = frame.children.filter(c => c.visible).length;
    if (!hasLayout || childCount < 2) continue;

    total++;
    const hasGap = (frame.itemSpacing ?? 0) > 0;
    const hasSB = frame.primaryAxisAlignItems === 'SPACE_BETWEEN';
    if (hasGap || hasSB) {
      pass++;
    } else {
      issues.push({
        nodeId: frame.id, nodeName: frame.name, dimension: 'spacing',
        message: `${childCount} children, no gap`,
        fix: `edit({path: "/#${frame.id}/", props: {gap: 16}})`,
      });
    }
  }

  return total > 0 ? Math.round((pass / total) * 100) : 100;
}

// ─── Dimension 2: Padding ────────────────────────────────────────

function scorePadding(data: TreeData, issues: QualityIssue[]): number {
  let total = 0;
  let pass = 0;

  for (const frame of data.frames) {
    const hasLayout = frame.layoutMode && frame.layoutMode !== 'NONE';
    if (!hasLayout || frame.children.length === 0) continue;

    const hasFill = frame.fills && Array.isArray(frame.fills) &&
      frame.fills.length > 0 && frame.fills.some((f: Paint) => f.visible !== false);
    if (!hasFill) continue;

    total++;
    const hasPadding = (frame.paddingTop ?? 0) > 0 || (frame.paddingRight ?? 0) > 0 ||
      (frame.paddingBottom ?? 0) > 0 || (frame.paddingLeft ?? 0) > 0;
    if (hasPadding) {
      pass++;
    } else {
      issues.push({
        nodeId: frame.id, nodeName: frame.name, dimension: 'padding',
        message: `has fill but no padding`,
        fix: `edit({path: "/#${frame.id}/", props: {p: 16}})`,
      });
    }
  }

  return total > 0 ? Math.round((pass / total) * 100) : 100;
}

// ─── Dimension 3: Hierarchy ──────────────────────────────────────

function scoreHierarchy(data: TreeData, issues: QualityIssue[]): number {
  if (data.allNodes.length === 0) return 0;

  // Depth: 2-5 ideal
  let depthScore: number;
  if (data.maxDepth >= 2 && data.maxDepth <= 5) depthScore = 100;
  else if (data.maxDepth === 1) { depthScore = 60; issues.push({ nodeId: '', nodeName: '', dimension: 'hierarchy', message: 'Flat hierarchy — only 1 level deep', fix: 'Group related elements into sub-frames' }); }
  else if (data.maxDepth <= 7) depthScore = 80;
  else { depthScore = 60; issues.push({ nodeId: '', nodeName: '', dimension: 'hierarchy', message: `Over-nested: ${data.maxDepth} levels`, fix: 'Flatten unnecessary wrapper frames' }); }

  // Naming: % of frames with semantic names (not "Frame 123")
  const genericPattern = /^(frame|group|rectangle|ellipse|vector|rect|line)\s*\d*$/i;
  const namedFrames = data.frames.filter(f => !genericPattern.test(f.name));
  const namingScore = data.frames.length > 0 ? (namedFrames.length / data.frames.length) * 100 : 50;

  return Math.round(depthScore * 0.6 + namingScore * 0.4);
}

// ─── Dimension 4: Spacing Grid (4px) ────────────────────────────

function scoreSpacingGrid(data: TreeData, issues: QualityIssue[]): number {
  const spacings: number[] = [];

  for (const frame of data.frames) {
    if (frame.itemSpacing != null && frame.itemSpacing > 0) spacings.push(frame.itemSpacing);
    for (const p of [frame.paddingTop, frame.paddingRight, frame.paddingBottom, frame.paddingLeft]) {
      if (p != null && p > 0) spacings.push(p);
    }
  }

  if (spacings.length < 2) return 100;

  const onGrid = spacings.filter(s => s % 4 === 0);
  const adherence = Math.round((onGrid.length / spacings.length) * 100);

  if (adherence < 80) {
    const offGrid = [...new Set(spacings.filter(s => s % 4 !== 0))].sort((a, b) => a - b);
    issues.push({
      nodeId: '', nodeName: '', dimension: 'spacingGrid',
      message: `${100 - adherence}% of spacings off 4px grid: [${offGrid.join(',')}]`,
      fix: `Use 4px multiples: 4, 8, 12, 16, 20, 24, 32, 48`,
    });
  }

  return adherence;
}

// ─── Dimension 5: Typography ─────────────────────────────────────

function scoreTypography(data: TreeData, issues: QualityIssue[]): number {
  if (data.texts.length < 2) return 100;

  const sizes = new Set<number>();
  const weights = new Set<string>();
  for (const t of data.texts) {
    const fs = t.fontSize;
    if (typeof fs === 'number') sizes.add(fs);
    const fn = t.fontName;
    if (fn && typeof fn === 'object' && 'style' in fn) weights.add((fn as FontName).style);
  }

  // Size variety: 3-5 ideal
  let sizeScore: number;
  if (sizes.size >= 3 && sizes.size <= 5) sizeScore = 100;
  else if (sizes.size === 2) sizeScore = 70;
  else if (sizes.size === 1) { sizeScore = 40; issues.push({ nodeId: '', nodeName: '', dimension: 'typography', message: 'Only 1 font size — no hierarchy', fix: 'Use at least 3 sizes: heading (24+), body (14-16), small (12)' }); }
  else if (sizes.size <= 7) sizeScore = 80;
  else { sizeScore = 60; issues.push({ nodeId: '', nodeName: '', dimension: 'typography', message: `${sizes.size} font sizes — too many`, fix: 'Consolidate to 3-5 sizes' }); }

  // Weight variety: 2-3 ideal
  let weightScore: number;
  if (weights.size >= 2 && weights.size <= 3) weightScore = 100;
  else if (weights.size === 1) { weightScore = 60; issues.push({ nodeId: '', nodeName: '', dimension: 'typography', message: 'Only 1 font weight', fix: 'Add Bold for headings, Medium for labels' }); }
  else weightScore = 80;

  // Heading/body ratio
  const sortedSizes = [...sizes].sort((a, b) => b - a);
  const ratio = sortedSizes.length >= 2 ? sortedSizes[0] / sortedSizes[sortedSizes.length - 1] : 1;
  let ratioScore: number;
  if (ratio >= 1.5 && ratio <= 4) ratioScore = 100;
  else if (ratio < 1.5) { ratioScore = 60; issues.push({ nodeId: '', nodeName: '', dimension: 'typography', message: `Heading/body ratio too small (${ratio.toFixed(1)}x)`, fix: 'Make headings at least 1.5x body size' }); }
  else ratioScore = 70;

  return Math.round(sizeScore * 0.4 + weightScore * 0.3 + ratioScore * 0.3);
}

// ─── Dimension 6: Layout Coverage ────────────────────────────────

function scoreLayoutCoverage(data: TreeData, issues: QualityIssue[]): number {
  const containers = data.frames.filter(f => f.children.length > 0);
  if (containers.length === 0) return 100;

  const withLayout = containers.filter(f => f.layoutMode && f.layoutMode !== 'NONE');
  const ratio = Math.round((withLayout.length / containers.length) * 100);

  if (ratio < 90) {
    const noLayout = containers.filter(f => !f.layoutMode || f.layoutMode === 'NONE');
    for (const frame of noLayout.slice(0, 3)) {
      issues.push({
        nodeId: frame.id, nodeName: frame.name, dimension: 'layoutCoverage',
        message: `${frame.children.length} children but no auto-layout`,
        fix: `edit({path: "/#${frame.id}/", props: {layout: "column"}})`,
      });
    }
  }

  return ratio;
}

// ─── Main Scorer ─────────────────────────────────────────────────

export async function scoreCreatedNodes(rootIds: string[]): Promise<QualityReport> {
  const issues: QualityIssue[] = [];
  const allData: TreeData = { frames: [], texts: [], allNodes: [], maxDepth: 0 };

  for (const rootId of rootIds) {
    const node = await figma.getNodeByIdAsync(rootId);
    if (!node || !('visible' in node) || !(node as SceneNode).visible) continue;
    const data = collectTreeData(node as SceneNode);
    allData.frames.push(...data.frames);
    allData.texts.push(...data.texts);
    allData.allNodes.push(...data.allNodes);
    allData.maxDepth = Math.max(allData.maxDepth, data.maxDepth);
  }

  const spacing = scoreSpacing(allData, issues);
  const padding = scorePadding(allData, issues);
  const hierarchy = scoreHierarchy(allData, issues);
  const spacingGrid = scoreSpacingGrid(allData, issues);
  const typography = scoreTypography(allData, issues);
  const layoutCoverage = scoreLayoutCoverage(allData, issues);

  // Weighted overall: spacing & padding most actionable
  const overall = Math.round(
    spacing * 0.25 + padding * 0.20 + hierarchy * 0.15 +
    spacingGrid * 0.10 + typography * 0.15 + layoutCoverage * 0.15
  );

  return { spacing, padding, hierarchy, spacingGrid, typography, layoutCoverage, overall, issues };
}

// ─── Formatter ───────────────────────────────────────────────────

export function formatQualityReport(report: QualityReport): string {
  const dims = [
    ['spacing', report.spacing],
    ['padding', report.padding],
    ['hierarchy', report.hierarchy],
    ['spacingGrid', report.spacingGrid],
    ['typography', report.typography],
    ['layout', report.layoutCoverage],
  ] as const;

  const allPerfect = dims.every(([, v]) => v === 100);
  const dimStr = dims.map(([k, v]) => `${k}:${v}%`).join(' ');

  if (allPerfect) {
    return `[quality] ✅ ${dimStr}`;
  }

  const lines: string[] = [];
  const failDims = dims.filter(([, v]) => v < 100).map(([k, v]) => `${k}:${v}%`).join(' ');
  lines.push(`[quality] ❌ ${failDims} — fix issues below, then inspect to re-check`);

  for (const issue of report.issues.slice(0, 12)) {
    lines.push(`  ⚠ [${issue.dimension}] "${issue.nodeName}" (${issue.nodeId}): ${issue.message} → ${issue.fix}`);
  }
  if (report.issues.length > 12) {
    lines.push(`  ... and ${report.issues.length - 12} more issues`);
  }

  return lines.join('\n');
}
