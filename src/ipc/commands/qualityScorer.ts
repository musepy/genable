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

import { rgbaToHex } from '../../utils/colorUtils';

interface QualityIssue {
  nodeId: string;
  nodeName: string;
  dimension: string;
  message: string;
  fix: string;
}

interface QualityReport {
  spacing: number;       // gap between children
  padding: number;       // surface frames have padding
  spacingSystem: number; // 4pt grid + spacing hierarchy
  typography: number;    // readability: min size, body ≥14, scale, weight
  contrast: number;      // WCAG AA text contrast
  layoutCoverage: number;// auto-layout usage
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
        fix: `edit({node: "${frame.id}", props: {gap: 16}})`,
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
        fix: `edit({node: "${frame.id}", props: {p: 16}})`,
      });
    }
  }

  return total > 0 ? Math.round((pass / total) * 100) : 100;
}

// ─── Dimension 3: Spacing System (4pt grid + hierarchy) ─────────
// Based on Impeccable spatial-design: 4pt grid, spacing hierarchy,
// "inside group < between groups < between sections"

function scoreSpacingSystem(data: TreeData, issues: QualityIssue[]): number {
  const spacings: number[] = [];

  for (const frame of data.frames) {
    if (frame.itemSpacing != null && frame.itemSpacing > 0) spacings.push(frame.itemSpacing);
    for (const p of [frame.paddingTop, frame.paddingRight, frame.paddingBottom, frame.paddingLeft]) {
      if (p != null && p > 0) spacings.push(p);
    }
  }

  if (spacings.length < 2) return 100;

  // 4pt grid adherence
  const onGrid = spacings.filter(s => s % 4 === 0);
  const gridScore = Math.round((onGrid.length / spacings.length) * 100);
  if (gridScore < 80) {
    const offGrid = [...new Set(spacings.filter(s => s % 4 !== 0))].sort((a, b) => a - b);
    issues.push({
      nodeId: '', nodeName: '', dimension: 'spacingSystem',
      message: `${100 - gridScore}% of spacings off 4pt grid: [${offGrid.join(',')}]`,
      fix: `Use 4pt multiples: 4, 8, 12, 16, 20, 24, 32, 48`,
    });
  }

  // Spacing variety: ≥2 distinct values means intentional hierarchy
  const unique = [...new Set(spacings)];
  const varietyScore = unique.length >= 2 ? 100 : 60;
  if (unique.length < 2) {
    issues.push({
      nodeId: '', nodeName: '', dimension: 'spacingSystem',
      message: 'Only 1 spacing value — no spatial hierarchy',
      fix: 'Use smaller gap inside groups, larger gap between sections',
    });
  }

  return Math.round(gridScore * 0.7 + varietyScore * 0.3);
}

// ─── Dimension 4: Typography (readability + hierarchy) ───────────
// Based on Impeccable typography: min 12px, body ≥14px, scale ratio,
// multi-dimensional hierarchy (size + weight together)

function scoreTypography(data: TreeData, issues: QualityIssue[]): number {
  if (data.texts.length < 2) return 100;

  const textInfos: Array<{ node: TextNode; size: number; weight: string }> = [];
  for (const t of data.texts) {
    const fs = t.fontSize;
    const fn = t.fontName;
    if (typeof fs === 'number' && fn && typeof fn === 'object' && 'style' in fn) {
      textInfos.push({ node: t, size: fs, weight: (fn as FontName).style });
    }
  }
  if (textInfos.length < 2) return 100;

  const sizes = [...new Set(textInfos.map(t => t.size))].sort((a, b) => b - a);
  const weights = new Set(textInfos.map(t => t.weight));

  // Min size: nothing below 12px
  let minSizeScore = 100;
  const tooSmall = textInfos.filter(t => t.size < 12);
  if (tooSmall.length > 0) {
    minSizeScore = 50;
    for (const t of tooSmall.slice(0, 3)) {
      issues.push({
        nodeId: t.node.id, nodeName: t.node.name, dimension: 'typography',
        message: `font size ${t.size}px < 12px minimum`,
        fix: `edit({node: "${t.node.id}", props: {size: 12}})`,
      });
    }
  }

  // Body text (most common size) should be ≥14px
  const sizeFreq = new Map<number, number>();
  for (const t of textInfos) sizeFreq.set(t.size, (sizeFreq.get(t.size) || 0) + 1);
  const bodySize = [...sizeFreq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  let bodyScore = 100;
  if (bodySize < 14) {
    bodyScore = 70;
    issues.push({
      nodeId: '', nodeName: '', dimension: 'typography',
      message: `Body text ${bodySize}px < 14px recommended`,
      fix: 'Increase most-used font size to at least 14px',
    });
  }

  // Scale ratio: heading/body should be 1.25-2x (consistent modular scale)
  let scaleScore = 100;
  if (sizes.length >= 2) {
    const ratio = sizes[0] / bodySize;
    if (ratio < 1.25) {
      scaleScore = 60;
      issues.push({
        nodeId: '', nodeName: '', dimension: 'typography',
        message: `Heading/body ratio ${ratio.toFixed(1)}x — too flat, needs more contrast`,
        fix: `Make headings at least ${Math.round(bodySize * 1.5)}px (1.5x body)`,
      });
    }
  }

  // Multi-dimensional hierarchy: using both size AND weight differentiation
  let hierarchyScore = 100;
  if (weights.size < 2) {
    hierarchyScore = 70;
    issues.push({
      nodeId: '', nodeName: '', dimension: 'typography',
      message: 'Only 1 font weight — hierarchy relies on size alone',
      fix: 'Use Bold for headings, Medium for labels, Regular for body',
    });
  }

  return Math.round(minSizeScore * 0.3 + bodyScore * 0.25 + scaleScore * 0.25 + hierarchyScore * 0.2);
}

// ─── Dimension 5: Contrast (WCAG AA) ────────────────────────────
// Based on Impeccable color-and-contrast: body 4.5:1, large text 3:1

function scoreContrast(data: TreeData, issues: QualityIssue[]): number {
  let total = 0;
  let pass = 0;

  for (const text of data.texts) {
    const textFill = getTextColor(text);
    if (!textFill) continue;

    // Walk up to find parent with visible fill (background)
    const bgColor = findBackgroundColor(text);
    if (!bgColor) continue;

    total++;
    const ratio = contrastRatio(textFill, bgColor);
    const fs = typeof text.fontSize === 'number' ? text.fontSize : 16;
    const isLarge = fs >= 18 || (fs >= 14 && isTextBold(text));
    const required = isLarge ? 3.0 : 4.5;

    if (ratio >= required) {
      pass++;
    } else {
      issues.push({
        nodeId: text.id, nodeName: text.name, dimension: 'contrast',
        message: `contrast ${ratio.toFixed(1)}:1 < ${required}:1 AA (${fs}px on ${rgbaToHex(bgColor)})`,
        fix: `edit({node: "${text.id}", props: {fill: "#000000"}})`,
      });
    }
  }

  return total > 0 ? Math.round((pass / total) * 100) : 100;
}

// ── Contrast helpers ──

function getTextColor(text: TextNode): RGB | null {
  const fills = text.fills;
  if (!fills || !Array.isArray(fills)) return null;
  for (const f of fills as Paint[]) {
    if (f.type === 'SOLID' && f.visible !== false) return f.color;
  }
  return null;
}

function findBackgroundColor(node: SceneNode): RGB | null {
  let current: BaseNode | null = node.parent;
  while (current && 'fills' in current) {
    const frame = current as FrameNode;
    if (frame.fills && Array.isArray(frame.fills)) {
      for (const f of frame.fills as Paint[]) {
        if (f.type === 'SOLID' && f.visible !== false) return f.color;
      }
    }
    current = current.parent;
  }
  // Default: assume white background
  return { r: 1, g: 1, b: 1 };
}

function isTextBold(text: TextNode): boolean {
  const fn = text.fontName;
  if (!fn || typeof fn !== 'object' || !('style' in fn)) return false;
  return /bold|black|heavy/i.test((fn as FontName).style);
}

function luminance(c: RGB): number {
  const srgb = [c.r, c.g, c.b].map(v =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(fg: RGB, bg: RGB): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}


// ─── Dimension 6: Layout Coverage ────────────────────────────────

function scoreLayoutCoverage(data: TreeData, issues: QualityIssue[]): number {
  // Exclude icon frames: single-child frames whose only child is a vector/svg
  // These are generated by the icon renderer and don't need auto-layout
  const containers = data.frames.filter(f => {
    if (f.children.length === 0) return false;
    if (f.children.length === 1) {
      const child = f.children[0];
      if (child.type === 'VECTOR' || child.type === 'BOOLEAN_OPERATION' ||
          child.type === 'STAR' || child.type === 'POLYGON') return false;
    }
    return true;
  });
  if (containers.length === 0) return 100;

  const withLayout = containers.filter(f => f.layoutMode && f.layoutMode !== 'NONE');
  const ratio = Math.round((withLayout.length / containers.length) * 100);

  if (ratio < 90) {
    const noLayout = containers.filter(f => !f.layoutMode || f.layoutMode === 'NONE');
    for (const frame of noLayout.slice(0, 3)) {
      issues.push({
        nodeId: frame.id, nodeName: frame.name, dimension: 'layoutCoverage',
        message: `${frame.children.length} children but no auto-layout`,
        fix: `edit({node: "${frame.id}", props: {layout: "column"}})`,
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
  const spacingSystem = scoreSpacingSystem(allData, issues);
  const typography = scoreTypography(allData, issues);
  const contrast = scoreContrast(allData, issues);
  const layoutCoverage = scoreLayoutCoverage(allData, issues);

  const overall = Math.round(
    spacing * 0.20 + padding * 0.15 + spacingSystem * 0.15 +
    typography * 0.20 + contrast * 0.15 + layoutCoverage * 0.15
  );

  return { spacing, padding, spacingSystem, typography, contrast, layoutCoverage, overall, issues };
}

// ─── Formatter ───────────────────────────────────────────────────

export function formatQualityReport(report: QualityReport): string {
  const dims = [
    ['spacing', report.spacing],
    ['padding', report.padding],
    ['spacingSystem', report.spacingSystem],
    ['typography', report.typography],
    ['contrast', report.contrast],
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
