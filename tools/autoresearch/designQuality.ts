/**
 * Design Quality Evaluator — measures how GOOD a design looks, not just attribute presence.
 *
 * 6 quality dimensions computed from Figma node tree structure:
 *   1. Hierarchy Quality    — is there clear visual hierarchy (depth, nesting)?
 *   2. Spacing Consistency  — do spacing values follow a consistent scale?
 *   3. Color Palette        — are colors limited and intentional, not random?
 *   4. Typography Scale     — do font sizes follow a typographic scale?
 *   5. Layout Structure     — are auto-layouts used properly with clear sections?
 *   6. Visual Weight        — is content balanced, not lopsided or empty?
 *
 * Each dimension: 0-100. Overall = geometric mean (penalizes zeros harder than avg).
 *
 * Usage:
 *   import { evaluateDesignQuality } from './designQuality'
 *   const result = evaluateDesignQuality(nodes)
 */

// ─── Types ───────────────────────────────────────────────────────

interface SerializedNode {
  id: string;
  type: string;
  name: string;
  visible: boolean;
  width: number;
  height: number;
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  fills?: any[];
  cornerRadius?: number;
  fontSize?: number;
  fontName?: { family: string; style: string };
  characters?: string;
  children?: SerializedNode[];
}

export interface DesignQualityMetrics {
  hierarchyQuality: number;    // 0-100
  spacingConsistency: number;  // 0-100
  colorPalette: number;        // 0-100
  typographyScale: number;     // 0-100
  layoutStructure: number;     // 0-100
  visualWeight: number;        // 0-100
}

export interface DesignQualityResult {
  metrics: DesignQualityMetrics;
  score: number;  // 0-100 geometric mean
  issues: string[];
  details: {
    nodeCount: number;
    maxDepth: number;
    uniqueSpacings: number[];
    uniqueFontSizes: number[];
    uniqueColors: string[];
    layoutFrameRatio: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function flatten(nodes: SerializedNode[], depth = 0): Array<{ node: SerializedNode; depth: number }> {
  const result: Array<{ node: SerializedNode; depth: number }> = [];
  for (const node of nodes) {
    if (!node.visible) continue;
    result.push({ node, depth });
    if (node.children) {
      result.push(...flatten(node.children, depth + 1));
    }
  }
  return result;
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  // Avoid zero killing everything — floor at 5
  const clamped = values.map(v => Math.max(v, 5));
  const product = clamped.reduce((a, b) => a * b, 1);
  return Math.pow(product, 1 / values.length);
}

// ─── Dimension 1: Hierarchy Quality ──────────────────────────────
// Good design has clear nesting: root → sections → content → details
// Score based on: depth range (2-5 ideal), balanced branching, named nodes

function calcHierarchyQuality(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[]; maxDepth: number } {
  const issues: string[] = [];
  if (all.length === 0) return { score: 0, issues: ['No nodes'], maxDepth: 0 };

  const maxDepth = Math.max(...all.map(a => a.depth));
  const frames = all.filter(a => a.node.type === 'FRAME' || a.node.type === 'COMPONENT');

  // Depth score: 2-5 is ideal, 0-1 is flat, 6+ is over-nested
  let depthScore: number;
  if (maxDepth >= 2 && maxDepth <= 5) depthScore = 100;
  else if (maxDepth === 1) { depthScore = 60; issues.push('Flat hierarchy — only 1 level deep'); }
  else if (maxDepth === 0) { depthScore = 20; issues.push('No nesting at all'); }
  else if (maxDepth <= 7) depthScore = 80;
  else { depthScore = 60; issues.push(`Over-nested: ${maxDepth} levels deep`); }

  // Naming score: what % of frames have semantic names (not "Frame 123")
  const genericPattern = /^(frame|group|rectangle|ellipse|vector)\s*\d*$/i;
  const namedFrames = frames.filter(f => !genericPattern.test(f.node.name));
  const namingScore = frames.length > 0 ? (namedFrames.length / frames.length) * 100 : 50;
  if (namingScore < 50) issues.push(`${Math.round(100 - namingScore)}% of frames have generic names`);

  // Branching score: root should have 2-8 direct children (sections)
  const rootNodes = all.filter(a => a.depth === 0);
  const rootChildren = rootNodes.flatMap(a => a.node.children || []);
  let branchScore: number;
  if (rootChildren.length >= 2 && rootChildren.length <= 8) branchScore = 100;
  else if (rootChildren.length === 1) { branchScore = 70; issues.push('Root has only 1 child — flat structure'); }
  else if (rootChildren.length > 8) { branchScore = 70; issues.push(`Root has ${rootChildren.length} direct children — consider grouping`); }
  else branchScore = 30;

  return {
    score: depthScore * 0.4 + namingScore * 0.3 + branchScore * 0.3,
    issues,
    maxDepth,
  };
}

// ─── Dimension 2: Spacing Consistency ────────────────────────────
// Good design uses a limited spacing scale (e.g., 4, 8, 12, 16, 24, 32)
// Bad design has random values (7, 13, 19, 37)

function calcSpacingConsistency(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[]; uniqueSpacings: number[] } {
  const issues: string[] = [];
  const spacings: number[] = [];

  for (const { node } of all) {
    if (node.itemSpacing != null && node.itemSpacing > 0) spacings.push(node.itemSpacing);
    for (const p of [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft]) {
      if (p != null && p > 0) spacings.push(p);
    }
  }

  if (spacings.length < 2) return { score: 70, issues: ['Too few spacing values to evaluate'], uniqueSpacings: spacings };

  // Count unique values
  const unique = [...new Set(spacings)].sort((a, b) => a - b);

  // Common design scales: multiples of 4 or 8
  const onScale = spacings.filter(s => s % 4 === 0);
  const scaleAdherence = onScale.length / spacings.length;

  // Fewer unique values = more consistent
  // 3-6 unique values is ideal for most designs
  let varietyScore: number;
  if (unique.length <= 6) varietyScore = 100;
  else if (unique.length <= 10) varietyScore = 80;
  else { varietyScore = Math.max(40, 100 - (unique.length - 6) * 8); issues.push(`${unique.length} different spacing values — consider using a scale`); }

  // Scale adherence (multiples of 4)
  const scaleScore = scaleAdherence * 100;
  if (scaleAdherence < 0.7) issues.push(`Only ${Math.round(scaleAdherence * 100)}% of spacings are multiples of 4`);

  return {
    score: varietyScore * 0.5 + scaleScore * 0.5,
    issues,
    uniqueSpacings: unique,
  };
}

// ─── Dimension 3: Color Palette ──────────────────────────────────
// Good design uses 3-8 intentional colors
// Bad design uses too many random hex values

function calcColorPalette(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[]; uniqueColors: string[] } {
  const issues: string[] = [];
  const colors: string[] = [];

  for (const { node } of all) {
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.type === 'SOLID' && fill.visible !== false && fill.color) {
          const { r, g, b } = fill.color;
          const hex = `#${[r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
          colors.push(hex.toUpperCase());
        }
      }
    }
  }

  if (colors.length === 0) return { score: 50, issues: ['No solid fills found — evaluator may lack fill data'], uniqueColors: [] };

  const unique = [...new Set(colors)];

  // 3-8 unique colors is ideal
  let paletteScore: number;
  if (unique.length >= 3 && unique.length <= 8) paletteScore = 100;
  else if (unique.length >= 2 && unique.length <= 12) paletteScore = 80;
  else if (unique.length === 1) { paletteScore = 60; issues.push('Only 1 color — monotone design'); }
  else { paletteScore = Math.max(30, 100 - (unique.length - 8) * 5); issues.push(`${unique.length} unique colors — consider consolidating`); }

  // Check for near-duplicates (colors within 10 RGB distance)
  let nearDupes = 0;
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      if (hexDistance(unique[i], unique[j]) < 30) nearDupes++;
    }
  }
  if (nearDupes > 0) {
    paletteScore -= nearDupes * 5;
    issues.push(`${nearDupes} near-duplicate color pair(s) — consolidate similar colors`);
  }

  return {
    score: Math.max(0, paletteScore),
    issues,
    uniqueColors: unique,
  };
}

function hexDistance(a: string, b: string): number {
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

// ─── Dimension 4: Typography Scale ───────────────────────────────
// Good design uses 3-5 distinct font sizes in a clear hierarchy
// Bad design has random sizes or too many variants

function calcTypographyScale(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[]; uniqueFontSizes: number[] } {
  const issues: string[] = [];
  const sizes: number[] = [];
  const weights = new Set<string>();

  for (const { node } of all) {
    if (node.type === 'TEXT') {
      if (node.fontSize) sizes.push(node.fontSize);
      if (node.fontName?.style) weights.add(node.fontName.style);
    }
  }

  if (sizes.length < 2) return { score: 70, issues: ['Too few text nodes to evaluate typography'], uniqueFontSizes: sizes };

  const uniqueSizes = [...new Set(sizes)].sort((a, b) => b - a);

  // 3-5 unique sizes is ideal (heading, subheading, body, small, caption)
  let sizeScore: number;
  if (uniqueSizes.length >= 3 && uniqueSizes.length <= 5) sizeScore = 100;
  else if (uniqueSizes.length === 2) { sizeScore = 70; issues.push('Only 2 font sizes — limited hierarchy'); }
  else if (uniqueSizes.length === 1) { sizeScore = 40; issues.push('Only 1 font size — no typographic hierarchy'); }
  else if (uniqueSizes.length <= 7) sizeScore = 80;
  else { sizeScore = Math.max(40, 100 - (uniqueSizes.length - 5) * 10); issues.push(`${uniqueSizes.length} font sizes — too many variants`); }

  // Check for reasonable ratio between largest and smallest
  const ratio = uniqueSizes[0] / uniqueSizes[uniqueSizes.length - 1];
  let ratioScore: number;
  if (ratio >= 1.5 && ratio <= 4) ratioScore = 100;
  else if (ratio < 1.5) { ratioScore = 60; issues.push('Heading/body ratio too small — weak hierarchy'); }
  else { ratioScore = 70; }

  // Weight variety: 2-3 weights is ideal (Regular + Bold, maybe Medium)
  let weightScore: number;
  if (weights.size >= 2 && weights.size <= 3) weightScore = 100;
  else if (weights.size === 1) { weightScore = 60; issues.push('Only 1 font weight — no emphasis differentiation'); }
  else weightScore = 80;

  return {
    score: sizeScore * 0.5 + ratioScore * 0.3 + weightScore * 0.2,
    issues,
    uniqueFontSizes: uniqueSizes,
  };
}

// ─── Dimension 5: Layout Structure ───────────────────────────────
// Good design uses auto-layout consistently for alignment
// Bad design mixes positioned and auto-layout children

function calcLayoutStructure(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[]; layoutFrameRatio: number } {
  const issues: string[] = [];
  const frames = all.filter(a =>
    (a.node.type === 'FRAME' || a.node.type === 'COMPONENT') &&
    a.node.children && a.node.children.length > 0
  );

  if (frames.length === 0) return { score: 50, issues: ['No container frames found'], layoutFrameRatio: 0 };

  const withLayout = frames.filter(f => f.node.layoutMode && f.node.layoutMode !== 'NONE');
  const layoutRatio = withLayout.length / frames.length;

  // 90%+ auto-layout usage is ideal
  let layoutScore: number;
  if (layoutRatio >= 0.9) layoutScore = 100;
  else if (layoutRatio >= 0.7) layoutScore = 80;
  else if (layoutRatio >= 0.5) { layoutScore = 60; issues.push(`Only ${Math.round(layoutRatio * 100)}% of containers use auto-layout`); }
  else { layoutScore = 30; issues.push(`Low auto-layout usage: ${Math.round(layoutRatio * 100)}%`); }

  // Check for proper nesting: sections should have clear grouping
  const layoutFrames = withLayout;
  let sizingScore = 100;
  for (const { node } of layoutFrames) {
    const children = node.children || [];
    const fillChildren = children.filter(c =>
      c.type === 'FRAME' && (
        (c as any).layoutSizingHorizontal === 'FILL' ||
        (c as any).layoutSizingVertical === 'FILL'
      )
    );
    // At least some children should use FILL sizing for proper layout
    if (children.length > 2 && fillChildren.length === 0) {
      sizingScore -= 5;
    }
  }
  sizingScore = Math.max(50, sizingScore);

  return {
    score: layoutScore * 0.7 + sizingScore * 0.3,
    issues,
    layoutFrameRatio: layoutRatio,
  };
}

// ─── Dimension 6: Visual Weight Distribution ─────────────────────
// Good design has balanced content — not all text, not all empty frames
// Checks: text-to-frame ratio, presence of interactive elements

function calcVisualWeight(all: Array<{ node: SerializedNode; depth: number }>): { score: number; issues: string[] } {
  const issues: string[] = [];

  const texts = all.filter(a => a.node.type === 'TEXT');
  const frames = all.filter(a => a.node.type === 'FRAME' || a.node.type === 'COMPONENT');
  const totalVisible = all.length;

  if (totalVisible < 3) return { score: 30, issues: ['Too few nodes for meaningful design'], };

  // Text-to-total ratio: 30-60% text is balanced
  const textRatio = texts.length / totalVisible;
  let textScore: number;
  if (textRatio >= 0.25 && textRatio <= 0.6) textScore = 100;
  else if (textRatio < 0.15) { textScore = 50; issues.push('Very few text nodes — design may lack content'); }
  else if (textRatio > 0.7) { textScore = 60; issues.push('Mostly text — may lack visual structure'); }
  else textScore = 80;

  // Content density: is there actual text content or just empty placeholders?
  const withContent = texts.filter(t => t.node.characters && t.node.characters.trim().length > 0);
  const contentScore = texts.length > 0 ? (withContent.length / texts.length) * 100 : 50;
  if (contentScore < 80) issues.push(`${Math.round(100 - contentScore)}% of text nodes are empty`);

  // Interactive elements: buttons, inputs suggest functional design
  const interactiveNames = /button|btn|input|field|toggle|switch|checkbox|link|tab|cta/i;
  const interactiveCount = all.filter(a => interactiveNames.test(a.node.name)).length;
  const interactiveScore = interactiveCount > 0 ? Math.min(100, 50 + interactiveCount * 15) : 40;
  if (interactiveCount === 0) issues.push('No interactive elements detected (buttons, inputs)');

  return {
    score: textScore * 0.35 + contentScore * 0.35 + interactiveScore * 0.3,
    issues,
  };
}

// ─── Main Evaluator ──────────────────────────────────────────────

export function evaluateDesignQuality(nodes: SerializedNode[]): DesignQualityResult {
  const all = flatten(nodes);
  const allIssues: string[] = [];

  const hierarchy = calcHierarchyQuality(all);
  const spacing = calcSpacingConsistency(all);
  const color = calcColorPalette(all);
  const typography = calcTypographyScale(all);
  const layout = calcLayoutStructure(all);
  const weight = calcVisualWeight(all);

  allIssues.push(...hierarchy.issues, ...spacing.issues, ...color.issues,
    ...typography.issues, ...layout.issues, ...weight.issues);

  const metrics: DesignQualityMetrics = {
    hierarchyQuality: Math.round(hierarchy.score),
    spacingConsistency: Math.round(spacing.score),
    colorPalette: Math.round(color.score),
    typographyScale: Math.round(typography.score),
    layoutStructure: Math.round(layout.score),
    visualWeight: Math.round(weight.score),
  };

  const score = Math.round(geometricMean(Object.values(metrics)));

  return {
    metrics,
    score,
    issues: allIssues,
    details: {
      nodeCount: all.length,
      maxDepth: hierarchy.maxDepth,
      uniqueSpacings: spacing.uniqueSpacings,
      uniqueFontSizes: typography.uniqueFontSizes,
      uniqueColors: color.uniqueColors,
      layoutFrameRatio: layout.layoutFrameRatio,
    },
  };
}

// ─── CLI ─────────────────────────────────────────────────────────

{
  (async () => {
    const { readFile, readdir, stat } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const RESULT_DIR = process.env.BRIDGE_DIR
      ? join(process.env.BRIDGE_DIR, 'results')
      : '/tmp/figma-bridge/results';

    let resultDir = process.argv[2];

    if (!resultDir) {
      // Find latest result
      const entries = await readdir(RESULT_DIR);
      let latest = '';
      let latestTime = 0;
      for (const entry of entries) {
        const s = await stat(join(RESULT_DIR, entry));
        if (s.mtimeMs > latestTime) { latestTime = s.mtimeMs; latest = entry; }
      }
      resultDir = join(RESULT_DIR, latest);
    }

    console.log(`Evaluating: ${resultDir}\n`);

    // Priority: reconstruct from tool calls (isolates to current run)
    // Fallback: tree.json (includes entire page — may be contaminated)
    let nodes: SerializedNode[] = [];
    let source = 'unknown';

    try {
      const metaJson = await readFile(join(resultDir, 'meta.json'), 'utf-8');
      const meta = JSON.parse(metaJson);
      for (const tc of (meta.toolCallDetails || [])) {
        if (tc.status !== 'success') continue;
        try {
          const params = typeof tc.params === 'string' ? JSON.parse(tc.params) : tc.params;
          if (tc.name === 'jsx' && params?.markup) {
            nodes.push(...buildNodesFromJsxSimple(params.markup));
          }
        } catch {}
      }
      if (nodes.length > 0) source = 'jsx-tool-calls';
    } catch {}

    if (nodes.length === 0) {
      try {
        const treeJson = await readFile(join(resultDir, 'tree.json'), 'utf-8');
        const tree = JSON.parse(treeJson);
        nodes = tree.nodes || tree.children || [tree];
        source = 'tree.json';
        console.log('⚠ Using tree.json (entire page) — scores may include non-current nodes');
      } catch {}
    }

    console.log(`Source: ${source} (${nodes.length} root nodes)`);

    if (nodes.length === 0) {
      console.log('ERROR: No nodes to evaluate');
      process.exit(1);
    }

    const result = evaluateDesignQuality(nodes);

    console.log(`DESIGN QUALITY SCORE: ${result.score}/100\n`);
    console.log('Dimensions:');
    for (const [key, val] of Object.entries(result.metrics)) {
      const bar = '█'.repeat(Math.round(val / 5)) + '░'.repeat(20 - Math.round(val / 5));
      console.log(`  ${key.padEnd(22)} ${bar} ${val}`);
    }
    console.log(`\nDetails:`);
    console.log(`  Nodes: ${result.details.nodeCount}`);
    console.log(`  Max depth: ${result.details.maxDepth}`);
    console.log(`  Spacings: [${result.details.uniqueSpacings.join(', ')}]`);
    console.log(`  Font sizes: [${result.details.uniqueFontSizes.join(', ')}]`);
    console.log(`  Colors: [${result.details.uniqueColors.join(', ')}]`);
    console.log(`  Layout ratio: ${Math.round(result.details.layoutFrameRatio * 100)}%`);

    if (result.issues.length > 0) {
      console.log(`\nIssues (${result.issues.length}):`);
      for (const issue of result.issues) {
        console.log(`  ⚠ ${issue}`);
      }
    }
  })();
}

// Simplified JSX parser for CLI mode
function buildNodesFromJsxSimple(markup: string): SerializedNode[] {
  const roots: SerializedNode[] = [];
  const stack: SerializedNode[] = [];
  let idCounter = 0;
  let pos = 0;

  while (pos < markup.length) {
    while (pos < markup.length && /\s/.test(markup[pos])) pos++;
    if (pos >= markup.length) break;

    if (markup[pos] === '<' && markup[pos + 1] !== '/') {
      const tagMatch = markup.slice(pos).match(/^<(\w+)((?:\s+[\w.$:-]+(?:=(?:\{[^}]*\}|"[^"]*"|'[^']*'|\S+))?)*)\s*(\/?)>/);
      if (!tagMatch) { pos++; continue; }
      const [fullMatch, tag, attrsStr, selfClosing] = tagMatch;
      pos += fullMatch.length;

      const props: Record<string, string> = {};
      let name = '';
      const attrRegex = /([\w.$:-]+)=(?:\{([^}]*)\}|"([^"]*)"|'([^']*)'|(\S+))/g;
      let am;
      while ((am = attrRegex.exec(attrsStr)) !== null) {
        const key = am[1]; const val = am[2] ?? am[3] ?? am[4] ?? am[5] ?? '';
        if (key === 'name') { name = val; continue; }
        props[key] = val;
      }

      const nodeType = tag === 'text' ? 'TEXT' : 'FRAME';
      const node: SerializedNode = { id: `jsx-${++idCounter}`, type: nodeType, name: name || tag, visible: true, width: 100, height: 100 };

      if (props.layout) node.layoutMode = props.layout === 'row' ? 'HORIZONTAL' : props.layout === 'column' ? 'VERTICAL' : props.layout;
      if (props.w && !isNaN(parseFloat(props.w))) { node.width = parseFloat(props.w); }
      if (props.h && !isNaN(parseFloat(props.h))) { node.height = parseFloat(props.h); }
      if (props.gap) node.itemSpacing = parseFloat(props.gap) || 0;
      if (props.p) { const v = parseFloat(props.p) || 0; node.paddingTop = v; node.paddingRight = v; node.paddingBottom = v; node.paddingLeft = v; }
      if (props.bg && props.bg !== 'transparent') node.fills = [{ type: 'SOLID', visible: true, color: hexToRgb(props.bg) }];
      if (props.corner) node.cornerRadius = parseFloat(props.corner) || 0;
      if (props.fill && nodeType === 'TEXT') node.fills = [{ type: 'SOLID', visible: true, color: hexToRgb(props.fill) }];
      if (nodeType === 'TEXT') {
        if (props.size) node.fontSize = parseFloat(props.size);
        if (props.weight) node.fontName = { family: 'Inter', style: props.weight };
        else node.fontName = { family: 'Inter', style: 'Regular' };
        const closeIdx = markup.indexOf(`</${tag}>`, pos);
        if (closeIdx >= 0) { node.characters = markup.slice(pos, closeIdx).trim(); pos = closeIdx; }
      }

      if (stack.length > 0) { const p = stack[stack.length - 1]; if (!p.children) p.children = []; p.children.push(node); }
      else roots.push(node);
      if (!selfClosing && nodeType !== 'TEXT') stack.push(node);
    } else if (markup[pos] === '<' && markup[pos + 1] === '/') {
      const closeMatch = markup.slice(pos).match(/^<\/\w+>/);
      pos += closeMatch ? closeMatch[0].length : 1;
      stack.pop();
    } else { pos++; }
  }
  return roots;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | undefined {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return undefined;
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}
