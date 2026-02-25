/**
 * @file postOpValidator.ts
 * @description Lightweight post-operation anomaly detector.
 *
 * Runs on the **main thread** immediately after a node is created/modified.
 * Returns compact anomaly strings ONLY when something is wrong.
 * Empty array = all good = zero extra tokens in the tool result.
 *
 * Design principles:
 * - Cheap: heuristic checks, no heavy computation
 * - Compact: each anomaly is one short string the LLM can act on
 * - Anomaly-only: no feedback when things are fine
 */

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface PostOpIntended {
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  width?: number;
  height?: number;
  textAutoResize?: string;
  [key: string]: any;
}

// ──────────────────────────────────────────────
// Main validator
// ──────────────────────────────────────────────

/**
 * Validate a single node after creation/modification.
 * @param node  The actual Figma SceneNode
 * @param intended  Optional: what the LLM intended (for delta checks)
 * @returns Array of compact anomaly strings. Empty = no issues.
 */
export function validatePostOp(node: SceneNode, intended?: PostOpIntended): string[] {
  const anomalies: string[] = [];

  // 1. Zero dimensions
  if ('width' in node && 'height' in node) {
    if (node.width === 0 || node.height === 0) {
      anomalies.push(`ZERO_DIM: '${node.name}' has ${node.width === 0 ? 'width' : 'height'}=0`);
    }
  }

  // 2. Invisible (opacity = 0)
  if ('opacity' in node && node.opacity === 0) {
    anomalies.push(`INVISIBLE: '${node.name}' has opacity=0`);
  }

  // 3. Text-specific checks
  if (node.type === 'TEXT') {
    const t = node as TextNode;
    anomalies.push(...validateTextNode(t, intended));
  }

  // 4. Frame children overflow
  if (node.type === 'FRAME' || node.type === 'COMPONENT') {
    anomalies.push(...validateFrameOverflow(node as FrameNode));
    anomalies.push(...validateSiblingConsistency(node as FrameNode));  // NEW
    anomalies.push(...validateMissingAutoLayout(node as FrameNode));   // NEW
  }

  // 5. Sizing reverted (FILL → FIXED because parent lacks auto-layout)
  if (intended) {
    anomalies.push(...validateSizingRevert(node, intended));
  }

  return anomalies;
}

// ──────────────────────────────────────────────
// Text checks
// ──────────────────────────────────────────────

function validateTextNode(t: TextNode, intended?: PostOpIntended): string[] {
  const anomalies: string[] = [];
  const content = t.characters || '';
  if (!content) return anomalies;

  // TEXT_OVERFLOW: fixed box with content that likely overflows
  if (t.textAutoResize === 'NONE' && t.width > 0 && t.height > 0) {
    const estimatedLines = estimateLineCount(content, t.width, getFontSize(t));
    const estimatedHeight = estimatedLines * getFontSize(t) * 1.3; // ~1.3x line spacing
    if (estimatedHeight > t.height * 1.1) { // 10% tolerance
      const preview = content.length > 20 ? content.slice(0, 20) + '…' : content;
      anomalies.push(
        `TEXT_OVERFLOW: '${t.name}' text "${preview}" overflows (est ${Math.round(estimatedHeight)}px > box ${Math.round(t.height)}px). Consider textAutoResize=HEIGHT or TRUNCATE.`
      );
    }
  }

  // TEXT_WRAP_MISSING: FILL width but textAutoResize=WIDTH_AND_HEIGHT means no wrapping
  if (t.textAutoResize === 'WIDTH_AND_HEIGHT') {
    const isLikelyFill = 'layoutSizingHorizontal' in t &&
                         (t as any).layoutSizingHorizontal === 'FILL';
    const isLongContent = content.length > 60 || content.includes('\n');

    if (isLikelyFill && isLongContent) {
      anomalies.push(
        `TEXT_WRAP_MISSING: '${t.name}' has FILL width + long text but textAutoResize=WIDTH_AND_HEIGHT (no wrapping). Set textAutoResize=HEIGHT to enable wrapping.`
      );
    }
  }

  return anomalies;
}

// ──────────────────────────────────────────────
// Frame children overflow & Layout anomalies
// ──────────────────────────────────────────────

function validateFrameOverflow(frame: FrameNode): string[] {
  const anomalies: string[] = [];

  // Only check for FIXED sizing (HUG/FILL adjust automatically)
  const hSizing = (frame as any).layoutSizingHorizontal;
  const vSizing = (frame as any).layoutSizingVertical;
  const isFixedH = !hSizing || hSizing === 'FIXED';
  const isFixedV = !vSizing || vSizing === 'FIXED';

  if (!isFixedH && !isFixedV) return anomalies;
  if (!frame.children || frame.children.length === 0) return anomalies;

  // For auto-layout frames, check if children total exceeds frame
  if (frame.layoutMode && frame.layoutMode !== 'NONE') {
    const isHorizontal = frame.layoutMode === 'HORIZONTAL';
    let childrenExtent = 0;
    const gap = (frame as any).itemSpacing || 0;

    for (const child of frame.children) {
      if (!('width' in child)) continue;
      if (isHorizontal) {
        childrenExtent += child.width;
      } else {
        childrenExtent += child.height;
      }
    }
    // Add gaps between children
    childrenExtent += Math.max(0, frame.children.length - 1) * gap;

    // Add padding
    const paddingStart = isHorizontal ? (frame.paddingLeft || 0) : (frame.paddingTop || 0);
    const paddingEnd = isHorizontal ? (frame.paddingRight || 0) : (frame.paddingBottom || 0);
    const totalRequired = childrenExtent + paddingStart + paddingEnd;

    const frameExtent = isHorizontal ? frame.width : frame.height;
    const isFixedAxis = isHorizontal ? isFixedH : isFixedV;

    if (isFixedAxis && totalRequired > frameExtent * 1.05) { // 5% tolerance
      anomalies.push(
        `CHILDREN_OVERFLOW: '${frame.name}' children need ~${Math.round(totalRequired)}px but frame is ${Math.round(frameExtent)}px (${frame.layoutMode}). Consider larger frame or FILL/HUG sizing.`
      );
    }
  }

  return anomalies;
}

/**
 * Detect children with inconsistent widths in a VERTICAL layout frame.
 * Common issue: table rows or list items with different explicit widths.
 */
function validateSiblingConsistency(frame: FrameNode): string[] {
  const anomalies: string[] = [];
  
  if (!frame.layoutMode || frame.layoutMode === 'NONE') return anomalies;
  if (!frame.children || frame.children.length < 2) return anomalies;
  // Only check VERTICAL layouts (rows should have consistent widths)
  if (frame.layoutMode === 'VERTICAL') {
    const childFrames = frame.children.filter(
      c => c.type === 'FRAME' && 'width' in c
    ) as FrameNode[];
    
    if (childFrames.length < 2) return anomalies;
    
    // Check if children that should be uniform (FILL) are instead FIXED with different widths
    const fixedWidthChildren = childFrames.filter(c => {
      const hSizing = (c as any).layoutSizingHorizontal;
      return !hSizing || hSizing === 'FIXED';
    });
    
    if (fixedWidthChildren.length >= 2) {
      const widths = fixedWidthChildren.map(c => Math.round(c.width));
      const uniqueWidths = new Set(widths);
      if (uniqueWidths.size > 1 && fixedWidthChildren.length >= 2) {
        anomalies.push(
          `SIBLING_WIDTH_MISMATCH: '${frame.name}' has ${fixedWidthChildren.length} child frames with inconsistent widths (${Array.from(uniqueWidths).join(', ')}px). Consider layoutSizingHorizontal=FILL for uniform width.`
        );
      }
    }
  }
  
  return anomalies;
}

/**
 * Detect frames with multiple children but no auto-layout.
 * Without layout mode, children stack at (0,0).
 */
function validateMissingAutoLayout(frame: FrameNode): string[] {
  const anomalies: string[] = [];
  
  if (frame.layoutMode && frame.layoutMode !== 'NONE') return anomalies;
  if (!frame.children || frame.children.length < 2) return anomalies;
  
  // Check if multiple children are at the same position (overlapping)
  const positions = frame.children
    .filter(c => 'x' in c && 'y' in c)
    .map(c => `${Math.round((c as any).x)},${Math.round((c as any).y)}`);
  
  const uniquePositions = new Set(positions);
  if (positions.length >= 2 && uniquePositions.size === 1) {
    anomalies.push(
      `MISSING_AUTO_LAYOUT: '${frame.name}' has ${frame.children.length} children but no Auto Layout — they overlap at the same position. Add layoutMode=VERTICAL or HORIZONTAL.`
    );
  }
  
  return anomalies;
}

// ──────────────────────────────────────────────
// Sizing revert detection
// ──────────────────────────────────────────────

function validateSizingRevert(node: SceneNode, intended: PostOpIntended): string[] {
  const anomalies: string[] = [];

  if (!('layoutSizingHorizontal' in node)) return anomalies;

  const actualH = (node as any).layoutSizingHorizontal;
  const actualV = (node as any).layoutSizingVertical;

  if (intended.layoutSizingHorizontal === 'FILL' && actualH !== 'FILL') {
    anomalies.push(
      `SIZING_REVERTED: '${node.name}' horizontal sizing intended FILL but actual is ${actualH || 'FIXED'}. Parent may lack auto-layout.`
    );
  }

  if (intended.layoutSizingVertical === 'FILL' && actualV !== 'FILL') {
    anomalies.push(
      `SIZING_REVERTED: '${node.name}' vertical sizing intended FILL but actual is ${actualV || 'FIXED'}. Parent may lack auto-layout.`
    );
  }

  return anomalies;
}

// ──────────────────────────────────────────────
// Tree-level collection
// ──────────────────────────────────────────────

/**
 * Walk a node tree and collect anomalies from all nodes.
 * Returns prefixed anomalies for context: "path/to/node: ANOMALY_TYPE: ..."
 */
export function collectTreeAnomalies(
  root: SceneNode,
  maxDepth: number = 5,
  maxAnomalies: number = 10
): string[] {
  const anomalies: string[] = [];
  walkTree(root, 0, maxDepth, anomalies, maxAnomalies);
  return anomalies;
}

function walkTree(
  node: SceneNode,
  depth: number,
  maxDepth: number,
  anomalies: string[],
  maxAnomalies: number
): void {
  if (depth > maxDepth || anomalies.length >= maxAnomalies) return;

  const nodeAnomalies = validatePostOp(node);
  anomalies.push(...nodeAnomalies.slice(0, maxAnomalies - anomalies.length));

  if ('children' in node && (node as any).children) {
    for (const child of (node as any).children) {
      if (anomalies.length >= maxAnomalies) break;
      walkTree(child, depth + 1, maxDepth, anomalies, maxAnomalies);
    }
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function getFontSize(t: TextNode): number {
  const fs = t.fontSize;
  if (typeof fs === 'number') return fs;
  return 14; // fallback for mixed fonts
}

/**
 * Rough estimate of how many lines text will occupy at a given width.
 * Uses average character width heuristic (~0.55 * fontSize for Latin, ~1.0 for CJK).
 */
function estimateLineCount(text: string, containerWidth: number, fontSize: number): number {
  if (containerWidth <= 0 || fontSize <= 0) return 1;

  const lines = text.split('\n');
  let totalLines = 0;

  for (const line of lines) {
    if (line.length === 0) {
      totalLines += 1;
      continue;
    }
    // Heuristic: CJK characters are roughly 1em wide, Latin ~0.55em
    const cjkCount = (line.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    const latinCount = line.length - cjkCount;
    const estimatedWidth = (cjkCount * fontSize) + (latinCount * fontSize * 0.55);
    totalLines += Math.max(1, Math.ceil(estimatedWidth / containerWidth));
  }

  return totalLines;
}
