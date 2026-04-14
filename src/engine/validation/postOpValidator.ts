/**
 * @file postOpValidator.ts
 * @description Lightweight post-operation violation detector.
 *
 * Runs on the **main thread** immediately after a node is created/modified.
 * Returns structured violation objects with context and actionable hints.
 * Empty array = all good = zero extra tokens in the tool result.
 *
 * Design principles:
 * - Cheap: heuristic checks, no heavy computation
 * - Structured: each violation is a typed object with context + hints for Agent debugging
 * - Violation-only: no feedback when things are fine
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

/**
 * Structured violation object returned by the validator.
 * Replaces the old `string[]` format to give Agent actionable context.
 */
export interface ValidationViolation {
  /** Machine-readable violation type, e.g. "SIZING_REVERTED" */
  code: string;
  /** Human-readable description of the violation */
  message: string;
  /** Figma node ID of the problematic node */
  nodeId: string;
  /** Figma node name */
  nodeName: string;
  /**
   * Key properties of the node (and its parent) that explain WHY this violation occurred.
   * Agent can read this to identify the root cause without extra read calls.
   */
  context: Record<string, any>;
  /**
   * Actionable fix suggestions. Each hint is a concrete action the Agent can take,
   * phrased as a tool-call-ready instruction (not a tutorial).
   * Typically 1-3 mutually exclusive options.
   */
  hints: string[];
}

// ──────────────────────────────────────────────
// Main validator
// ──────────────────────────────────────────────

/**
 * Validate a single node after creation/modification.
 * @param node  The actual Figma SceneNode
 * @param intended  Optional: what the LLM intended (for delta checks)
 * @returns Array of structured violation objects. Empty = no issues.
 */
export function validatePostOp(node: SceneNode, intended?: PostOpIntended): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  // 1. Zero dimensions (LINE is always h=0 — skip height check)
  if ('width' in node && 'height' in node) {
    const isLine = node.type === 'LINE';
    if (node.width === 0 || (!isLine && node.height === 0)) {
      const zeroDim = node.width === 0 ? 'width' : 'height';
      violations.push({
        code: 'ZERO_DIM',
        message: `'${node.name}' has ${zeroDim}=0`,
        nodeId: node.id,
        nodeName: node.name,
        context: {
          width: node.width,
          height: node.height,
          type: node.type,
        },
        hints: [
          `Set ${zeroDim} to a positive value (e.g. patchNode nodeId="${node.id}" props={${zeroDim}: 100})`,
          `Or set layoutSizing${zeroDim === 'width' ? 'Horizontal' : 'Vertical'} to "FILL" or "HUG" to auto-size`,
        ],
      });
    }
  }

  // 2. Invisible (opacity = 0)
  if ('opacity' in node && node.opacity === 0) {
    violations.push({
      code: 'INVISIBLE',
      message: `'${node.name}' has opacity=0`,
      nodeId: node.id,
      nodeName: node.name,
      context: {
        opacity: 0,
        visible: 'visible' in node ? node.visible : undefined,
      },
      hints: [
        `Set opacity to 1 (patchNode nodeId="${node.id}" props={opacity: 1})`,
        `Or delete the node if it was unintentional`,
      ],
    });
  }

  // 3. Text-specific checks
  if (node.type === 'TEXT') {
    const t = node as TextNode;
    violations.push(...validateTextNode(t, intended));
    violations.push(...validateTextMissingStyle(t));
    violations.push(...validateLowContrast(t));
  }

  // 4. Frame children overflow
  if (node.type === 'FRAME' || node.type === 'COMPONENT') {
    violations.push(...validateFrameOverflow(node as FrameNode));
    violations.push(...validateSiblingConsistency(node as FrameNode));
    violations.push(...validateMissingAutoLayout(node as FrameNode));
    violations.push(...validateHugFillCycle(node as FrameNode));
    violations.push(...validateEmptyFrame(node as FrameNode));
    violations.push(...validateCornerRadiusMismatch(node as FrameNode));
  }

  // 5. Banned names — Figma default names indicate LLM forgot to name the node
  violations.push(...validateBannedName(node));

  // 5a. White-on-white border
  if ('fills' in node && 'strokes' in node) {
    violations.push(...validateWhiteOnWhite(node));
  }

  // 6. Sizing reverted (FILL → FIXED because parent lacks auto-layout)
  if (intended) {
    violations.push(...validateSizingRevert(node, intended));
  }

  // 7. Small tap target (interactive elements below 44×44)
  if ('width' in node && 'height' in node) {
    violations.push(...validateSmallTapTarget(node));
  }

  return violations;
}

// ──────────────────────────────────────────────
// Text checks
// ──────────────────────────────────────────────

function validateTextNode(t: TextNode, intended?: PostOpIntended): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const content = t.characters || '';
  if (!content) return violations;

  // TEXT_OVERFLOW: fixed box with content that likely overflows
  if (t.textAutoResize === 'NONE' && t.width > 0 && t.height > 0) {
    const estimatedLines = estimateLineCount(content, t.width, getFontSize(t));
    const estimatedHeight = estimatedLines * getFontSize(t) * 1.3; // ~1.3x line spacing
    if (estimatedHeight > t.height * 1.1) { // 10% tolerance
      const preview = content.length > 20 ? content.slice(0, 20) + '…' : content;
      violations.push({
        code: 'TEXT_OVERFLOW',
        message: `'${t.name}' text "${preview}" overflows (est ${Math.round(estimatedHeight)}px > box ${Math.round(t.height)}px)`,
        nodeId: t.id,
        nodeName: t.name,
        context: {
          textAutoResize: t.textAutoResize,
          containerWidth: Math.round(t.width),
          containerHeight: Math.round(t.height),
          estimatedContentHeight: Math.round(estimatedHeight),
          fontSize: getFontSize(t),
          contentLength: content.length,
        },
        hints: [
          `Set textAutoResize to "HEIGHT" to auto-expand vertically (patchNode nodeId="${t.id}" props={textAutoResize: "HEIGHT"})`,
          `Or increase container height to ${Math.round(estimatedHeight + 10)}px`,
          `Or set textAutoResize to "TRUNCATE" to clip overflow`,
        ],
      });
    }
  }

  // TEXT_WIDTH_COLLAPSED: HEIGHT text in a very narrow box, causing per-word stacking.
  if (t.textAutoResize === 'HEIGHT' && !content.includes('\n') && content.length >= 6 && t.width > 0) {
    const fontSize = getFontSize(t);
    const estimatedLines = estimateLineCount(content, t.width, fontSize);
    const narrowWidthThreshold = Math.max(96, fontSize * 4);
    if (estimatedLines >= 3 && t.width <= narrowWidthThreshold) {
      // Check if parent is auto-layout — if so, suggest sizingH:fill
      const parentHint = getParentLayoutHint(t);
      violations.push({
        code: 'TEXT_WIDTH_COLLAPSED',
        message: `'${t.name}' is wrapping into a narrow ${Math.round(t.width)}px text box (${estimatedLines} estimated lines)`,
        nodeId: t.id,
        nodeName: t.name,
        context: {
          textAutoResize: t.textAutoResize,
          width: Math.round(t.width),
          estimatedLines,
          fontSize,
          contentLength: content.length,
          ...parentHint.context,
        },
        hints: parentHint.hasAutoLayoutParent
          ? [
            `Set layoutSizingHorizontal to "FILL" so text expands to parent width`,
            `If this is a short label, switch to textAutoResize="WIDTH_AND_HEIGHT"`,
          ]
          : [
            `If this is a short label or heading, switch to textAutoResize="WIDTH_AND_HEIGHT" and remove width`,
            `If this text should wrap, widen the text box beyond ${Math.round(narrowWidthThreshold)}px`,
          ],
      });
    }
  }

  return violations;
}

// ──────────────────────────────────────────────
// Frame children overflow & layout violations
// ──────────────────────────────────────────────

function validateFrameOverflow(frame: FrameNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  // Only check for FIXED sizing (HUG/FILL adjust automatically)
  const hSizing = (frame as any).layoutSizingHorizontal;
  const vSizing = (frame as any).layoutSizingVertical;
  const isFixedH = !hSizing || hSizing === 'FIXED';
  const isFixedV = !vSizing || vSizing === 'FIXED';

  if (!isFixedH && !isFixedV) return violations;
  if (!frame.children || frame.children.length === 0) return violations;

  // For auto-layout frames, check if children total exceeds frame.
  // Skip GRID — overflow math is rows×columns, not linear stacking.
  if (frame.layoutMode && frame.layoutMode !== 'NONE' && frame.layoutMode !== 'GRID') {
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
      const axis = isHorizontal ? 'width' : 'height';
      violations.push({
        code: 'CHILDREN_OVERFLOW',
        message: `'${frame.name}' children need ~${Math.round(totalRequired)}px but frame is ${Math.round(frameExtent)}px (${frame.layoutMode})`,
        nodeId: frame.id,
        nodeName: frame.name,
        context: {
          layoutMode: frame.layoutMode,
          [`frame.${axis}`]: Math.round(frameExtent),
          childrenExtent: Math.round(childrenExtent),
          totalRequired: Math.round(totalRequired),
          itemSpacing: gap,
          childCount: frame.children.length,
          [`layoutSizing${isHorizontal ? 'Horizontal' : 'Vertical'}`]: isHorizontal ? hSizing : vSizing,
        },
        hints: [
          `Increase frame ${axis} to at least ${Math.round(totalRequired + 10)}px`,
          `Or set layoutSizing${isHorizontal ? 'Horizontal' : 'Vertical'} to "HUG" to auto-fit children`,
          `Or reduce number of children / their sizes`,
        ],
      });
    }
  }

  return violations;
}

/**
 * Detect children with inconsistent widths in a VERTICAL layout frame.
 * Common issue: table rows or list items with different explicit widths.
 */
function validateSiblingConsistency(frame: FrameNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  
  if (!frame.layoutMode || frame.layoutMode === 'NONE') return violations;
  if (!frame.children || frame.children.length < 2) return violations;
  // Only check VERTICAL layouts (rows should have consistent widths)
  if (frame.layoutMode === 'VERTICAL') {
    const childFrames = frame.children.filter(
      c => c.type === 'FRAME' && 'width' in c
    ) as FrameNode[];
    
    if (childFrames.length < 2) return violations;
    
    // Check if children that should be uniform (FILL) are instead FIXED with different widths
    const fixedWidthChildren = childFrames.filter(c => {
      const hSizing = (c as any).layoutSizingHorizontal;
      return !hSizing || hSizing === 'FIXED';
    });
    
    if (fixedWidthChildren.length >= 2) {
      const widths = fixedWidthChildren.map(c => Math.round(c.width));
      const uniqueWidths = new Set(widths);
      if (uniqueWidths.size > 1 && fixedWidthChildren.length >= 2) {
        const childNames = fixedWidthChildren.slice(0, 3).map(c => c.name).join(', ');
        violations.push({
          code: 'SIBLING_WIDTH_MISMATCH',
          message: `'${frame.name}' has ${fixedWidthChildren.length} child frames with inconsistent widths (${Array.from(uniqueWidths).join(', ')}px)`,
          nodeId: frame.id,
          nodeName: frame.name,
          context: {
            layoutMode: frame.layoutMode,
            childWidths: widths,
            affectedChildren: childNames,
            parentWidth: Math.round(frame.width),
          },
          hints: [
            `Set layoutSizingHorizontal to "FILL" on all child frames for uniform width`,
            `Use edit to batch-update: <frame id="${fixedWidthChildren.slice(0, 3).map(c => c.id).join('"/><frame id="')}" sizingH="FILL"/>`,
          ],
        });
      }
    }
  }
  
  return violations;
}

/**
 * Detect frames with multiple children but no auto-layout.
 * Without layout mode, children stack at (0,0).
 */
function validateMissingAutoLayout(frame: FrameNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  
  if (frame.layoutMode && frame.layoutMode !== 'NONE') return violations;
  if (!frame.children || frame.children.length < 2) return violations;
  
  // Check if multiple children are at the same position (overlapping)
  const positions = frame.children
    .filter(c => 'x' in c && 'y' in c)
    .map(c => `${Math.round((c as any).x)},${Math.round((c as any).y)}`);
  
  const uniquePositions = new Set(positions);
  if (positions.length >= 2 && uniquePositions.size === 1) {
    const childNames = frame.children.slice(0, 3).map(c => c.name).join(', ');
    violations.push({
      code: 'MISSING_AUTO_LAYOUT',
      message: `'${frame.name}' has ${frame.children.length} children but no Auto Layout — they overlap at the same position`,
      nodeId: frame.id,
      nodeName: frame.name,
      context: {
        layoutMode: frame.layoutMode || 'NONE',
        childCount: frame.children.length,
        overlappingPosition: positions[0],
        affectedChildren: childNames,
      },
      hints: [
        `Set layoutMode to "VERTICAL" for stacked layout (patchNode nodeId="${frame.id}" props={layoutMode: "VERTICAL", itemSpacing: 8})`,
        `Or set layoutMode to "HORIZONTAL" for side-by-side layout (patchNode nodeId="${frame.id}" props={layoutMode: "HORIZONTAL", itemSpacing: 8})`,
      ],
    });
  }
  
  return violations;
}

// ──────────────────────────────────────────────
// HUG parent + FILL child cycle detection
// ──────────────────────────────────────────────

/**
 * Detect HUG parent + FILL child circular dependency.
 * A parent with HUG sizing depends on children to determine its size,
 * but a FILL child depends on its parent's size — creating an unsolvable cycle.
 * Figma silently falls back to FIXED, which is rarely what the Agent intended.
 */
function validateHugFillCycle(frame: FrameNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  if (!frame.layoutMode || frame.layoutMode === 'NONE') return violations;
  if (!frame.children || frame.children.length === 0) return violations;

  const parentHSizing = (frame as any).layoutSizingHorizontal;
  const parentVSizing = (frame as any).layoutSizingVertical;

  if (parentHSizing !== 'HUG' && parentVSizing !== 'HUG') return violations;

  for (const child of frame.children) {
    if (!('layoutSizingHorizontal' in child)) continue;

    const childHSizing = (child as any).layoutSizingHorizontal;
    const childVSizing = (child as any).layoutSizingVertical;

    // Horizontal cycle: parent HUG + child FILL
    if (parentHSizing === 'HUG' && childHSizing === 'FILL') {
      violations.push({
        code: 'HUG_FILL_CYCLE',
        message: `'${frame.name}' has HUG horizontal sizing but child '${child.name}' uses FILL — circular dependency`,
        nodeId: frame.id,
        nodeName: frame.name,
        context: {
          axis: 'horizontal',
          parentSizing: 'HUG',
          childId: child.id,
          childName: child.name,
          childSizing: 'FILL',
          layoutMode: frame.layoutMode,
        },
        hints: [
          `Change parent layoutSizingHorizontal to "FIXED" or "FILL" (patchNode nodeId="${frame.id}" props={layoutSizingHorizontal: "FIXED", width: ${Math.round(frame.width)}})`,
          `Or change child layoutSizingHorizontal to "HUG" or "FIXED" (patchNode nodeId="${child.id}" props={layoutSizingHorizontal: "HUG"})`,
        ],
      });
    }

    // Vertical cycle: parent HUG + child FILL
    if (parentVSizing === 'HUG' && childVSizing === 'FILL') {
      violations.push({
        code: 'HUG_FILL_CYCLE',
        message: `'${frame.name}' has HUG vertical sizing but child '${child.name}' uses FILL — circular dependency`,
        nodeId: frame.id,
        nodeName: frame.name,
        context: {
          axis: 'vertical',
          parentSizing: 'HUG',
          childId: child.id,
          childName: child.name,
          childSizing: 'FILL',
          layoutMode: frame.layoutMode,
        },
        hints: [
          `Change parent layoutSizingVertical to "FIXED" or "FILL" (patchNode nodeId="${frame.id}" props={layoutSizingVertical: "FIXED", height: ${Math.round(frame.height)}})`,
          `Or change child layoutSizingVertical to "HUG" or "FIXED" (patchNode nodeId="${child.id}" props={layoutSizingVertical: "HUG"})`,
        ],
      });
    }
  }

  return violations;
}

// ──────────────────────────────────────────────
// White-on-white border detection
// ──────────────────────────────────────────────

/**
 * Detect white stroke on white fill — invisible border that wastes visual intent.
 */
function validateWhiteOnWhite(node: SceneNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  const fills = (node as any).fills as Paint[] | undefined;
  const strokes = (node as any).strokes as Paint[] | undefined;

  if (!fills || !strokes || strokes.length === 0) return violations;

  const hasWhiteFill = fills.some(
    (f: Paint) => f.type === 'SOLID' && f.visible !== false && isWhiteColor(f.color)
  );
  const hasWhiteStroke = strokes.some(
    (s: Paint) => s.type === 'SOLID' && s.visible !== false && isWhiteColor(s.color)
  );

  if (hasWhiteFill && hasWhiteStroke) {
    violations.push({
      code: 'WHITE_ON_WHITE',
      message: `'${node.name}' has white border on white background — border is invisible`,
      nodeId: node.id,
      nodeName: node.name,
      context: {
        type: node.type,
        fillColor: '#FFFFFF',
        strokeColor: '#FFFFFF',
      },
      hints: [
        `Change stroke color to a visible grey (e.g. patchNode nodeId="${node.id}" props={strokes: [{type: "SOLID", color: {r: 0.88, g: 0.88, b: 0.88}}]})`,
        `Or remove the stroke entirely`,
      ],
    });
  }

  return violations;
}

function isWhiteColor(color: RGB): boolean {
  return color.r > 0.99 && color.g > 0.99 && color.b > 0.99;
}

// ──────────────────────────────────────────────
// Sizing revert detection
// ──────────────────────────────────────────────

function validateSizingRevert(node: SceneNode, intended: PostOpIntended): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  if (!('layoutSizingHorizontal' in node)) return violations;

  const actualH = (node as any).layoutSizingHorizontal;
  const actualV = (node as any).layoutSizingVertical;

  // Gather parent context (the key insight for Agent debugging)
  const parent = node.parent;
  const parentContext: Record<string, any> = {};
  if (parent && 'layoutMode' in parent) {
    parentContext['parent.id'] = parent.id;
    parentContext['parent.name'] = parent.name;
    parentContext['parent.layoutMode'] = (parent as any).layoutMode || 'NONE';
    parentContext['parent.type'] = parent.type;
  }

  if (intended.layoutSizingHorizontal === 'FILL' && actualH !== 'FILL') {
    violations.push({
      code: 'SIZING_REVERTED',
      message: `'${node.name}' horizontal sizing intended FILL but actual is ${actualH || 'FIXED'}. Parent may lack auto-layout.`,
      nodeId: node.id,
      nodeName: node.name,
      context: {
        axis: 'horizontal',
        intended: 'FILL',
        actual: actualH || 'FIXED',
        ...parentContext,
      },
      hints: parentContext['parent.layoutMode'] === 'NONE' || !parentContext['parent.layoutMode']
        ? [
            `Set parent '${parentContext['parent.name'] || 'unknown'}' layoutMode to "VERTICAL" or "HORIZONTAL" first (patchNode nodeId="${parentContext['parent.id']}" props={layoutMode: "VERTICAL"})`,
            `Then re-apply FILL on this node`,
            `Or use a fixed numeric width instead of FILL`,
          ]
        : [
            `Re-apply layoutSizingHorizontal="FILL" on this node (patchNode nodeId="${node.id}" props={layoutSizingHorizontal: "FILL"})`,
            `Or use a fixed numeric width instead`,
          ],
    });
  }

  if (intended.layoutSizingVertical === 'FILL' && actualV !== 'FILL') {
    violations.push({
      code: 'SIZING_REVERTED',
      message: `'${node.name}' vertical sizing intended FILL but actual is ${actualV || 'FIXED'}. Parent may lack auto-layout.`,
      nodeId: node.id,
      nodeName: node.name,
      context: {
        axis: 'vertical',
        intended: 'FILL',
        actual: actualV || 'FIXED',
        ...parentContext,
      },
      hints: parentContext['parent.layoutMode'] === 'NONE' || !parentContext['parent.layoutMode']
        ? [
            `Set parent '${parentContext['parent.name'] || 'unknown'}' layoutMode to "VERTICAL" or "HORIZONTAL" first (patchNode nodeId="${parentContext['parent.id']}" props={layoutMode: "VERTICAL"})`,
            `Then re-apply FILL on this node`,
            `Or use a fixed numeric height instead of FILL`,
          ]
        : [
            `Re-apply layoutSizingVertical="FILL" on this node (patchNode nodeId="${node.id}" props={layoutSizingVertical: "FILL"})`,
            `Or use a fixed numeric height instead`,
          ],
    });
  }

  return violations;
}

// ──────────────────────────────────────────────
// Low contrast detection (text vs background)
// ──────────────────────────────────────────────

/**
 * Detect text with insufficient contrast against its nearest background.
 * Walks up the parent chain to find the nearest ancestor with a solid fill,
 * then computes the WCAG contrast ratio.
 * Threshold: 3:1 minimum (more permissive than WCAG AA 4.5:1).
 */
function validateLowContrast(t: TextNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  const textFills = (t as any).fills;
  if (!Array.isArray(textFills)) return violations;

  const textSolid = textFills.find(
    (f: Paint) => f.type === 'SOLID' && f.visible !== false
  ) as SolidPaint | undefined;
  if (!textSolid) return violations;

  const bgColor = findNearestBackground(t);
  if (!bgColor) return violations;

  const textLum = relativeLuminance(textSolid.color);
  const bgLum = relativeLuminance(bgColor);
  const ratio = contrastRatio(textLum, bgLum);

  if (ratio < 3) {
    violations.push({
      code: 'LOW_CONTRAST',
      message: `'${t.name}' has contrast ratio ${ratio.toFixed(1)}:1 against background (minimum 3:1)`,
      nodeId: t.id,
      nodeName: t.name,
      context: {
        textColor: colorToHex(textSolid.color),
        backgroundColor: colorToHex(bgColor),
        contrastRatio: parseFloat(ratio.toFixed(2)),
      },
      hints: [
        bgLum > 0.5
          ? `Darken text color (e.g. #1A1A1A) for sufficient contrast`
          : `Lighten text color (e.g. #FFFFFF) for sufficient contrast`,
        `Or change the background color to increase contrast`,
      ],
    });
  }

  return violations;
}

/**
 * Walk up the parent chain to find the nearest ancestor with a visible solid fill.
 */
function findNearestBackground(node: SceneNode): RGB | null {
  let current = node.parent;
  while (current) {
    if ('fills' in current) {
      const fills = (current as any).fills;
      if (Array.isArray(fills)) {
        const solidFill = fills.find(
          (f: Paint) => f.type === 'SOLID' && f.visible !== false
        ) as SolidPaint | undefined;
        if (solidFill) return solidFill.color;
      }
    }
    current = (current as any).parent || null;
  }
  return null;
}

function relativeLuminance(color: RGB): number {
  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function colorToHex(color: RGB): string {
  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

// ──────────────────────────────────────────────
// Empty frame detection
// ──────────────────────────────────────────────

/**
 * Detect empty frames with no children and no fill.
 * Frames that serve as spacers (very narrow) or have a visible fill are excluded.
 */
function validateEmptyFrame(frame: FrameNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  if (frame.children && frame.children.length > 0) return violations;

  // Skip spacers/dividers (very thin)
  if (frame.width <= 4 || frame.height <= 4) return violations;

  // Skip frames with visible fill (decorative backgrounds, color blocks)
  const fills = (frame as any).fills;
  if (Array.isArray(fills) && fills.some((f: Paint) => f.visible !== false && f.type === 'SOLID')) {
    return violations;
  }

  violations.push({
    code: 'EMPTY_FRAME',
    message: `'${frame.name}' is an empty frame with no children and no fill`,
    nodeId: frame.id,
    nodeName: frame.name,
    context: {
      width: Math.round(frame.width),
      height: Math.round(frame.height),
    },
    hints: [
      `Add content to this frame or delete it if unneeded`,
      `If this is a spacer, use padding/gap on the parent instead`,
    ],
  });

  return violations;
}

// ──────────────────────────────────────────────
// Corner radius mismatch (child > parent)
// ──────────────────────────────────────────────

/**
 * Detect children with cornerRadius larger than their parent frame.
 * This creates visual artifacts where inner corners poke through the parent shape.
 * Also flags parents with cornerRadius but no clipsContent.
 */
function validateCornerRadiusMismatch(frame: FrameNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  if (!frame.children || frame.children.length === 0) return violations;

  const parentRadius = getMaxCornerRadius(frame);
  if (parentRadius === 0) return violations;

  for (const child of frame.children) {
    if (!('cornerRadius' in child)) continue;
    const childRadius = getMaxCornerRadius(child);
    if (childRadius > parentRadius) {
      const innerRadius = Math.max(0, parentRadius - Math.min(
        (frame as any).paddingTop || 0,
        (frame as any).paddingLeft || 0,
        (frame as any).paddingRight || 0,
        (frame as any).paddingBottom || 0,
      ));
      violations.push({
        code: 'CORNER_RADIUS_MISMATCH',
        message: `'${child.name}' cornerRadius ${childRadius}px > parent '${frame.name}' cornerRadius ${parentRadius}px`,
        nodeId: child.id,
        nodeName: child.name,
        context: {
          childCornerRadius: childRadius,
          parentCornerRadius: parentRadius,
          parentClipsContent: !!(frame as any).clipsContent,
        },
        hints: [
          `Reduce child cornerRadius to ~${innerRadius}px (parent radius minus padding)`,
          `Or increase parent cornerRadius to ${childRadius}px`,
          ...((frame as any).clipsContent ? [] : [`Set parent clipsContent to true to clip overflow`]),
        ],
      });
      break; // Only report first mismatch per frame
    }
  }

  return violations;
}

function getMaxCornerRadius(node: any): number {
  if (typeof node.cornerRadius === 'number') return node.cornerRadius;
  // Mixed corners — check individual values
  const corners = [
    node.topLeftRadius || 0,
    node.topRightRadius || 0,
    node.bottomLeftRadius || 0,
    node.bottomRightRadius || 0,
  ];
  return Math.max(...corners);
}

// ──────────────────────────────────────────────
// Small tap target detection
// ──────────────────────────────────────────────

const INTERACTIVE_PATTERN = /button|btn|icon|link|toggle|switch|checkbox|radio|tab\b|chip|tag|action|close|back|menu|cta/i;

/**
 * Detect interactive-looking elements (by name) that are too small for comfortable tapping.
 * WCAG 2.5.5 recommends at least 44×44px touch targets.
 */
function validateSmallTapTarget(node: SceneNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  if (!INTERACTIVE_PATTERN.test(node.name)) return violations;

  const w = (node as any).width as number;
  const h = (node as any).height as number;
  if (w >= 44 || h >= 44) return violations; // At least one dimension is large enough

  violations.push({
    code: 'SMALL_TAP_TARGET',
    message: `'${node.name}' is ${Math.round(w)}×${Math.round(h)}px — below 44×44px minimum tap target`,
    nodeId: node.id,
    nodeName: node.name,
    context: {
      width: Math.round(w),
      height: Math.round(h),
      minimumSize: 44,
    },
    hints: [
      `Increase size to at least 44×44px for accessibility`,
      `Or wrap in a larger transparent frame with padding for the tap area`,
    ],
  });

  return violations;
}

// ──────────────────────────────────────────────
// Banned name detection (Figma defaults)
// ──────────────────────────────────────────────

/**
 * Figma default node names — prefix match (case-insensitive).
 * Flagged because the LLM forgot to provide a semantic name.
 * Only check frames/components (structural nodes) — rect/line/ellipse are often decorative.
 */
const BANNED_NAME_PREFIXES = ['frame', 'unnamed', 'group', 'section'];

function validateBannedName(node: SceneNode): ValidationViolation[] {
  // Only check structural node types that should have semantic names
  if (node.type !== 'FRAME' && node.type !== 'COMPONENT') return [];

  const nameLower = node.name.toLowerCase();
  const matchedPrefix = BANNED_NAME_PREFIXES.find(p => nameLower.startsWith(p));
  if (!matchedPrefix) return [];

  return [{
    code: 'BANNED_NAME',
    message: `'${node.name}' has a generic Figma default name — give it a semantic name`,
    nodeId: node.id,
    nodeName: node.name,
    context: {
      type: node.type,
      matchedPrefix,
      childCount: 'children' in node ? (node as any).children?.length ?? 0 : 0,
    },
    hints: [
      `Rename to describe its purpose (e.g. "Header", "Card", "Nav Bar")`,
    ],
  }];
}

// ──────────────────────────────────────────────
// Text missing style detection
// ──────────────────────────────────────────────

/**
 * Detect text nodes with missing essential styles:
 * - No visible fill (invisible text)
 * - Font size below readable threshold
 */
function validateTextMissingStyle(t: TextNode): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const content = t.characters || '';
  if (!content) return violations;

  // Check for missing/empty fills (invisible text)
  const fills = (t as any).fills;
  const hasVisibleFill = Array.isArray(fills) && fills.some(
    (f: Paint) => f.visible !== false && f.type === 'SOLID'
  );
  if (!hasVisibleFill) {
    violations.push({
      code: 'TEXT_MISSING_STYLE',
      message: `'${t.name}' has no visible fill — text is invisible`,
      nodeId: t.id,
      nodeName: t.name,
      context: {
        fills: Array.isArray(fills) ? fills.length : 0,
        content: content.slice(0, 30),
      },
      hints: [
        `Add a text fill color (e.g. fill="#1A1A1A" for dark text)`,
      ],
    });
  }

  // Check for unreadably small font
  const fontSize = getFontSize(t);
  if (fontSize < 8) {
    violations.push({
      code: 'TEXT_MISSING_STYLE',
      message: `'${t.name}' has fontSize=${fontSize}px — below readable threshold (8px)`,
      nodeId: t.id,
      nodeName: t.name,
      context: {
        fontSize,
        content: content.slice(0, 30),
      },
      hints: [
        `Increase fontSize to at least 10px for body text or 12px for labels`,
      ],
    });
  }

  return violations;
}

// ──────────────────────────────────────────────
// Tree-level collection
// ──────────────────────────────────────────────

/**
 * Walk a node tree and collect violations from all nodes.
 * Returns structured ValidationViolation objects.
 */
export function collectTreeViolations(
  root: SceneNode,
  maxDepth: number = 5,
  maxViolations: number = 10
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  walkTree(root, 0, maxDepth, violations, maxViolations);
  return violations;
}

function walkTree(
  node: SceneNode,
  depth: number,
  maxDepth: number,
  violations: ValidationViolation[],
  maxViolations: number
): void {
  if (depth > maxDepth || violations.length >= maxViolations) return;

  const nodeViolations = validatePostOp(node);
  violations.push(...nodeViolations.slice(0, maxViolations - violations.length));

  if ('children' in node && (node as any).children) {
    for (const child of (node as any).children) {
      if (violations.length >= maxViolations) break;
      walkTree(child, depth + 1, maxDepth, violations, maxViolations);
    }
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Check if a node's parent has auto-layout, providing context for sizing hints.
 */
function getParentLayoutHint(node: SceneNode): {
  hasAutoLayoutParent: boolean;
  context: Record<string, any>;
} {
  const parent = node.parent;
  if (!parent || !('layoutMode' in parent)) {
    return { hasAutoLayoutParent: false, context: {} };
  }
  const parentFrame = parent as FrameNode;
  const hasLayout = parentFrame.layoutMode && parentFrame.layoutMode !== 'NONE';
  return {
    hasAutoLayoutParent: !!hasLayout,
    context: {
      'parent.name': parentFrame.name,
      'parent.layoutMode': parentFrame.layoutMode || 'NONE',
      'parent.width': Math.round(parentFrame.width),
    },
  };
}

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
