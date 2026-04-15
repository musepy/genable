/**
 * @file describeHandler.ts
 * @description Semantic describe tool — role detection + visual summary + lint rules.
 *
 * Unlike inspect (property mirror), describe returns a semantic view:
 *   - role: what the node IS (card, button, avatar, heading, divider, icon, ...)
 *   - summary: visual appearance in one line ("24px Inter Bold, #1A1A1A")
 *   - layout: layout description in one line ("vertical, 16px gap, 24px padding")
 *   - issues: per-node lint results with severity
 *
 * Lint rules ported from qualityScorer + OpenPencil-inspired additions:
 *   - Spacing: gap missing, off-grid, gap >> padding
 *   - Padding: surface without padding (role-aware), button without horizontal padding
 *   - Layout conflicts: grow/HUG, fill without auto-layout parent, stretch ignored
 *   - Overflow: child > parent, text overflow, cross-axis overflow
 *   - Contrast: WCAG AA
 *   - Structure: empty frame, invisible node, excessive nesting
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode } from './pathResolver';
import { PipelineTracer } from './pipelineTracer';

// ─── Types ──────────────────────────────────────────────────────

type Severity = 'error' | 'warning' | 'info';

interface DescribeIssue {
  severity: Severity;
  message: string;
  suggestion?: string; // actionable fix hint (e.g. "edit({node: \"1:2\", props: {p: 16}})")
}

interface DescribeNode {
  id: string;
  name: string;
  role: string;
  summary: string;
  layout?: string;
  issues?: DescribeIssue[];
  children?: DescribeNode[];
}

// ─── Role Detection ─────────────────────────────────────────────

function detectRole(node: SceneNode): string {
  const name = node.name.toLowerCase();
  const type = node.type;

  if (type === 'TEXT') return detectTextRole(node as TextNode);

  if (type !== 'FRAME' && type !== 'COMPONENT' && type !== 'INSTANCE') {
    if (type === 'VECTOR' || type === 'BOOLEAN_OPERATION') return 'graphic';
    if (type === 'RECTANGLE' || type === 'ELLIPSE') return 'shape';
    if (type === 'LINE') return 'divider';
    return type.toLowerCase();
  }

  const frame = node as FrameNode;
  const childCount = frame.children.length;

  // Icon: small frame (≤ 32px) with single vector/boolean child
  if (childCount === 1 && frame.width <= 32 && frame.height <= 32) {
    const child = frame.children[0];
    if (child.type === 'VECTOR' || child.type === 'BOOLEAN_OPERATION' ||
        child.type === 'STAR' || child.type === 'POLYGON') return 'icon';
  }

  // Avatar: small-ish frame with single image fill or single child, roughly square
  if (childCount <= 1 && frame.width <= 80 && frame.height <= 80 &&
      Math.abs(frame.width - frame.height) <= 4) {
    if (hasImageFill(frame) || name.includes('avatar') || name.includes('profile')) return 'avatar';
  }

  // Button: name heuristic + small frame with text child
  if (name.includes('button') || name.includes('btn') || name.includes('cta')) return 'button';
  if (childCount >= 1 && childCount <= 3 && hasTextChild(frame) &&
      frame.height <= 56 && hasFill(frame)) {
    // Likely a button-like element
    if (frame.layoutMode && frame.layoutMode !== 'NONE' &&
        frame.primaryAxisSizingMode === 'AUTO') return 'button';
  }

  // Divider: very thin frame (height ≤ 2 or width ≤ 2)
  if ((frame.height <= 2 && frame.width > 20) || (frame.width <= 2 && frame.height > 20)) return 'divider';

  // Card: has fill + padding + multiple children
  if (childCount >= 2 && hasFill(frame) && hasPadding(frame)) return 'card';
  if (name.includes('card')) return 'card';

  // Input: name heuristic
  if (name.includes('input') || name.includes('field') || name.includes('textfield')) return 'input';

  // Navigation
  if (name.includes('nav') || name.includes('header') || name.includes('toolbar')) return 'navigation';
  if (name.includes('tab')) return 'tab';

  // Section: large frame with children
  if (name.includes('section') || name.includes('container') || name.includes('wrapper')) return 'container';

  // Generic frame with layout
  if (frame.layoutMode && frame.layoutMode !== 'NONE') {
    return childCount > 0 ? 'group' : 'frame';
  }

  return 'frame';
}

function detectTextRole(text: TextNode): string {
  const fs = typeof text.fontSize === 'number' ? text.fontSize : 16;
  const fn = text.fontName;
  const isBold = fn && typeof fn === 'object' && 'style' in fn &&
    /bold|black|heavy/i.test((fn as FontName).style);

  if (fs >= 28) return 'heading(1)';
  if (fs >= 22 && isBold) return 'heading(2)';
  if (fs >= 18 && isBold) return 'heading(3)';
  if (fs <= 12) return 'caption';
  if (name_looks_like_label(text.name)) return 'label';
  return 'text';
}

function name_looks_like_label(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('label') || n.includes('tag') || n.includes('badge');
}

// ─── Summary Builders ───────────────────────────────────────────

function buildSummary(node: SceneNode): string {
  if (node.type === 'TEXT') return buildTextSummary(node as TextNode);

  const parts: string[] = [];
  parts.push(`${Math.round(node.width)}×${Math.round(node.height)}`);

  if ('fills' in node) {
    const fillDesc = describeFill(node as FrameNode);
    if (fillDesc) parts.push(fillDesc);
  }

  if ('cornerRadius' in node) {
    const r = (node as FrameNode).cornerRadius;
    if (typeof r === 'number' && r > 0) parts.push(`r=${r}`);
  }

  if ('effects' in node) {
    const effects = (node as FrameNode).effects;
    if (Array.isArray(effects) && effects.some((e: Effect) => e.visible !== false)) {
      const types = [...new Set(effects.filter((e: Effect) => e.visible !== false).map((e: Effect) => e.type))];
      parts.push(types.map(t => t.toLowerCase().replace('_', ' ')).join(', '));
    }
  }

  return parts.join(', ');
}

function buildTextSummary(text: TextNode): string {
  const parts: string[] = [];
  const content = typeof text.characters === 'string'
    ? (text.characters.length > 30 ? text.characters.slice(0, 30) + '…' : text.characters)
    : '';
  if (content) parts.push(`"${content}"`);

  const fs = typeof text.fontSize === 'number' ? text.fontSize : null;
  const fn = text.fontName;
  if (fs) parts.push(`${fs}px`);
  if (fn && typeof fn === 'object' && 'family' in fn) {
    parts.push(`${(fn as FontName).family} ${(fn as FontName).style}`);
  }

  const fill = getTextColor(text);
  if (fill) parts.push(rgbToHex(fill));

  return parts.join(' ');
}

function buildLayoutSummary(frame: FrameNode): string | undefined {
  if (!frame.layoutMode || frame.layoutMode === 'NONE') return undefined;

  const parts: string[] = [];
  parts.push(frame.layoutMode.toLowerCase());

  if (frame.layoutWrap === 'WRAP') parts.push('wrap');

  if ((frame.itemSpacing ?? 0) > 0) parts.push(`gap=${frame.itemSpacing}`);

  const pt = frame.paddingTop ?? 0;
  const pr = frame.paddingRight ?? 0;
  const pb = frame.paddingBottom ?? 0;
  const pl = frame.paddingLeft ?? 0;
  if (pt > 0 || pr > 0 || pb > 0 || pl > 0) {
    if (pt === pr && pr === pb && pb === pl) {
      parts.push(`p=${pt}`);
    } else if (pt === pb && pl === pr) {
      parts.push(`py=${pt} px=${pl}`);
    } else {
      parts.push(`p=[${pt},${pr},${pb},${pl}]`);
    }
  }

  const align = frame.primaryAxisAlignItems;
  if (align && align !== 'MIN') parts.push(`align=${align.toLowerCase()}`);

  return parts.join(', ');
}

// ─── Lint Rules ─────────────────────────────────────────────────

function detectIssues(node: SceneNode, role: string, parentNode?: SceneNode): DescribeIssue[] {
  const issues: DescribeIssue[] = [];

  if (node.type === 'TEXT') {
    detectTextIssues(node as TextNode, issues, parentNode);
    return issues;
  }

  if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE') {
    return issues;
  }

  const frame = node as FrameNode;

  // ── Structural ──
  detectStructuralIssues(frame, role, issues);

  // ── Spacing ──
  detectSpacingIssues(frame, role, issues);

  // ── Padding (role-aware) ──
  detectPaddingIssues(frame, role, issues);

  // ── Layout conflicts ──
  detectLayoutConflicts(frame, issues);

  // ── Overflow ──
  detectOverflow(frame, issues);

  return issues;
}

// Structural
function detectStructuralIssues(frame: FrameNode, role: string, issues: DescribeIssue[]) {
  // Empty frame with no fill — invisible
  if (frame.children.length === 0 && !hasFill(frame)) {
    issues.push({ severity: 'warning', message: 'Empty frame with no fill' });
  }

  // Excessive nesting: single-child wrapper chain
  if (frame.children.length === 1) {
    const child = frame.children[0];
    if ((child.type === 'FRAME' || child.type === 'COMPONENT' || child.type === 'INSTANCE') &&
        (child as FrameNode).children.length === 1 && role !== 'icon' && role !== 'avatar') {
      issues.push({
        severity: 'info',
        message: 'Single-child wrapper — may be unnecessary nesting',
      });
    }
  }

  // Subpixel position
  if (node_has_subpixel(frame)) {
    issues.push({ severity: 'info', message: `Subpixel position (${frame.x}, ${frame.y})` });
  }
}

// Spacing
function detectSpacingIssues(frame: FrameNode, role: string, issues: DescribeIssue[]) {
  const hasLayout = frame.layoutMode && frame.layoutMode !== 'NONE';
  if (!hasLayout) return;

  const childCount = frame.children.filter(c => c.visible).length;
  const gap = frame.itemSpacing ?? 0;

  // Multi-child layout with no gap
  if (childCount >= 2 && gap === 0 && frame.primaryAxisAlignItems !== 'SPACE_BETWEEN') {
    issues.push({
      severity: 'warning',
      message: `${childCount} children, no gap`,
      suggestion: `edit({node: "${frame.id}", props: {gap: 16}})`,
    });
  }

  // Gap off 4px grid
  if (gap > 0 && gap % 4 !== 0) {
    issues.push({
      severity: 'info',
      message: `Gap ${gap} not on 4px grid`,
      suggestion: `${nearest4(gap)}`,
    });
  }

  // Gap >> padding (gap > 2× padding)
  const maxPadding = Math.max(
    frame.paddingTop ?? 0, frame.paddingRight ?? 0,
    frame.paddingBottom ?? 0, frame.paddingLeft ?? 0
  );
  if (gap > 0 && maxPadding > 0 && gap > maxPadding * 2) {
    issues.push({
      severity: 'warning',
      message: `Gap ${gap} >> padding ${maxPadding}`,
    });
  }

  // Wrap without rowGap
  if (frame.layoutWrap === 'WRAP' && (frame.counterAxisSpacing ?? 0) === 0) {
    issues.push({
      severity: 'warning',
      message: 'Wrap without rowGap — rows stick together',
      suggestion: `edit({node: "${frame.id}", props: {counterAxisSpacing: ${gap || 8}}})`,
    });
  }
}

// Padding (role-aware)
function detectPaddingIssues(frame: FrameNode, role: string, issues: DescribeIssue[]) {
  // Skip roles that don't need padding
  if (role === 'icon' || role === 'avatar' || role === 'divider' || role === 'graphic') return;

  const hasLayout = frame.layoutMode && frame.layoutMode !== 'NONE';
  if (!hasLayout || frame.children.length === 0) return;
  if (!hasFill(frame)) return;

  const hp = hasPadding(frame);

  if (role === 'button') {
    // Button: only check horizontal padding
    const px = Math.max(frame.paddingLeft ?? 0, frame.paddingRight ?? 0);
    if (px === 0) {
      issues.push({
        severity: 'warning',
        message: 'Button has no horizontal padding',
        suggestion: `edit({node: "${frame.id}", props: {px: 16}})`,
      });
    }
    return;
  }

  // General surface frame: fill + children → needs padding
  if (!hp) {
    issues.push({
      severity: 'warning',
      message: 'Has fill but no padding',
      suggestion: `edit({node: "${frame.id}", props: {p: 16}})`,
    });
  }
}

// Layout conflicts
function detectLayoutConflicts(frame: FrameNode, issues: DescribeIssue[]) {
  const hasLayout = frame.layoutMode && frame.layoutMode !== 'NONE';

  for (const child of frame.children) {
    if (!child.visible) continue;
    if (!('layoutSizingHorizontal' in child)) continue;
    const c = child as FrameNode;

    // fill sizing without auto-layout parent
    if (!hasLayout) {
      if (c.layoutSizingHorizontal === 'FILL' || c.layoutSizingVertical === 'FILL') {
        issues.push({
          severity: 'error',
          message: `"${child.name}" uses fill sizing but parent has no auto-layout`,
        });
      }
      continue;
    }

    // grow inside HUG parent
    if ('layoutGrow' in c && (c as any).layoutGrow > 0) {
      const isMainAxis = frame.layoutMode === 'HORIZONTAL'
        ? frame.primaryAxisSizingMode === 'AUTO'
        : frame.counterAxisSizingMode === 'AUTO';
      if (isMainAxis) {
        issues.push({
          severity: 'error',
          message: `"${child.name}" grow inside HUG parent — no effect`,
          suggestion: `Set parent to FIXED or FILL, or remove grow`,
        });
      }
    }
  }

  // SPACE_BETWEEN with < 2 children
  if (hasLayout && frame.primaryAxisAlignItems === 'SPACE_BETWEEN') {
    const visibleChildren = frame.children.filter(c => c.visible).length;
    if (visibleChildren < 2) {
      issues.push({
        severity: 'warning',
        message: `SPACE_BETWEEN with ${visibleChildren} child — needs ≥2`,
      });
    }
  }
}

// Overflow
function detectOverflow(frame: FrameNode, issues: DescribeIssue[]) {
  const hasLayout = frame.layoutMode && frame.layoutMode !== 'NONE';
  if (!hasLayout) return;
  if (frame.clipsContent) return; // clipped — overflow invisible

  const isHorizontal = frame.layoutMode === 'HORIZONTAL';

  for (const child of frame.children) {
    if (!child.visible) continue;

    // Main axis overflow (child larger than parent)
    const mainAxisParent = isHorizontal ? frame.width : frame.height;
    const mainAxisChild = isHorizontal ? child.width : child.height;

    if (mainAxisChild > mainAxisParent * 1.1 && mainAxisParent > 0) {
      issues.push({
        severity: 'error',
        message: `"${child.name}" (${Math.round(mainAxisChild)}px) overflows "${frame.name}" (${Math.round(mainAxisParent)}px)`,
      });
    }

    // Cross axis overflow
    const crossParent = isHorizontal ? frame.height : frame.width;
    const crossChild = isHorizontal ? child.height : child.width;
    if (crossChild > crossParent * 1.1 && crossParent > 0) {
      issues.push({
        severity: 'warning',
        message: `"${child.name}" ${Math.round(crossChild)}px on cross axis, parent has ${Math.round(crossParent)}px`,
      });
    }
  }
}

// Text issues
function detectTextIssues(text: TextNode, issues: DescribeIssue[], parentNode?: SceneNode) {
  const fs = typeof text.fontSize === 'number' ? text.fontSize : 16;

  // No color — invisible text
  const color = getTextColor(text);
  if (!color) {
    issues.push({ severity: 'error', message: `"${text.name}" has no color — invisible` });
    return;
  }

  // WCAG AA contrast
  if (parentNode) {
    const bgColor = findBackgroundColor(text);
    if (bgColor) {
      const ratio = contrastRatio(color, bgColor);
      const isBold = text.fontName && typeof text.fontName === 'object' && 'style' in text.fontName &&
        /bold|black|heavy/i.test((text.fontName as FontName).style);
      const isLarge = fs >= 18 || (fs >= 14 && isBold);
      const required = isLarge ? 3.0 : 4.5;
      if (ratio < required) {
        issues.push({
          severity: 'warning',
          message: `Contrast ${ratio.toFixed(1)}:1 < ${required}:1 AA (${fs}px)`,
          suggestion: `edit({node: "${text.id}", props: {fill: "#000000"}})`,
        });
      }
    }
  }

  // Min size
  if (fs < 12) {
    issues.push({
      severity: 'warning',
      message: `Font size ${fs}px < 12px minimum`,
      suggestion: `edit({node: "${text.id}", props: {size: 12}})`,
    });
  }
}

// ─── Tree Walker ────────────────────────────────────────────────

function describeNode(node: SceneNode, depth: number, maxDepth: number, parentNode?: SceneNode): DescribeNode {
  const role = detectRole(node);
  const summary = buildSummary(node);

  const result: DescribeNode = {
    id: node.id,
    name: node.name,
    role,
    summary,
  };

  // Layout summary for frames
  if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    const layoutStr = buildLayoutSummary(node as FrameNode);
    if (layoutStr) result.layout = layoutStr;
  }

  // Lint
  const issues = detectIssues(node, role, parentNode);
  if (issues.length > 0) result.issues = issues;

  // Recurse children
  if (depth < maxDepth && 'children' in node) {
    const children = (node as FrameNode).children.filter(c => c.visible);
    if (children.length > 0) {
      result.children = children.map(c => describeNode(c, depth + 1, maxDepth, node));
    }
  }

  return result;
}

// ─── Handler ────────────────────────────────────────────────────

export async function handleDescribe(parameters: any): Promise<ToolResponse> {
  const ref = parameters.node;
  const maxDepth = Math.min(parameters.depth || 3, 8);

  if (!ref) {
    return { error: 'Missing required "node" parameter.' };
  }

  const tracer = new PipelineTracer();
  tracer.enter('handleDescribe()', 'describeHandler.ts');

  const resolved = await resolvePathToNode(ref);
  if (!resolved.ok) return resolved.response;

  if (resolved.isPage) {
    return { error: 'describe requires a specific node, not page root. Use inspect({node: "/"}) for page overview.' };
  }

  const result = describeNode(resolved.node, 0, maxDepth);
  tracer.exit();

  return { data: result, _stages: tracer.collect() };
}

// ─── Helpers ────────────────────────────────────────────────────

function hasFill(frame: FrameNode): boolean {
  return Array.isArray(frame.fills) &&
    frame.fills.length > 0 &&
    frame.fills.some((f: Paint) => f.visible !== false);
}

function hasImageFill(frame: FrameNode): boolean {
  return Array.isArray(frame.fills) &&
    frame.fills.some((f: Paint) => f.type === 'IMAGE' && f.visible !== false);
}

function hasPadding(frame: FrameNode): boolean {
  return (frame.paddingTop ?? 0) > 0 || (frame.paddingRight ?? 0) > 0 ||
    (frame.paddingBottom ?? 0) > 0 || (frame.paddingLeft ?? 0) > 0;
}

function hasTextChild(frame: FrameNode): boolean {
  return frame.children.some(c => c.type === 'TEXT');
}

function node_has_subpixel(node: SceneNode): boolean {
  return node.x % 1 !== 0 || node.y % 1 !== 0;
}

function nearest4(n: number): number {
  return Math.round(n / 4) * 4;
}

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
  return { r: 1, g: 1, b: 1 };
}

function rgbToHex(c: RGB): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

function describeFill(frame: FrameNode): string | null {
  if (!Array.isArray(frame.fills)) return null;
  for (const f of frame.fills as Paint[]) {
    if (f.visible === false) continue;
    if (f.type === 'SOLID') return rgbToHex(f.color);
    if (f.type === 'IMAGE') return 'image';
    if (f.type === 'GRADIENT_LINEAR') return 'gradient';
  }
  return null;
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
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
