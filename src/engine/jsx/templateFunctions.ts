/**
 * @file templateFunctions.ts
 * @description Pure template functions injected into JSX template execution context.
 *
 * 3 layers:
 *   Layer 1: Node type constants (injected as JSX element names)
 *   Layer 2: Compute functions (color, paint, gradient, effect)
 *   Layer 3: Design shortcuts (layout, spacing, sizing, alignment)
 *
 * All functions are pure — no side effects, no Figma API calls.
 * They return plain objects that walkTree() feeds to nodeFactory.
 */

import { parseHexToRGBA } from '../../utils/colorUtils';
import type { RGBA } from '../../utils/colorUtils';

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1: Node Type Constants
// ═══════════════════════════════════════════════════════════════════════════

export const Frame = 'FRAME';
export const Text = 'TEXT';
export const Rectangle = 'RECTANGLE';
export const Rect = 'RECTANGLE';
export const Ellipse = 'ELLIPSE';
export const Line = 'LINE';
export const Star = 'STAR';
export const Polygon = 'POLYGON';
export const Vector = 'VECTOR';
export const Group = 'GROUP';
export const Section = 'SECTION';
export const Component = 'COMPONENT';
export const Instance = 'INSTANCE';
export const BooleanOperation = 'BOOLEAN_OPERATION';
export const ComponentSet = 'COMPONENT_SET';
export const Icon = 'ICON';
export const Image = 'IMAGE';

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2: Compute Functions
// ═══════════════════════════════════════════════════════════════════════════

/** Convert hex string to Figma RGB (0-1 range). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const rgba = parseHexToRGBA(hex);
  return { r: rgba.r, g: rgba.g, b: rgba.b };
}

/** Convert 0-255 RGB to Figma RGBA (0-1 range). */
export function rgb(r: number, g: number, b: number, a?: number): RGBA {
  return { r: r / 255, g: g / 255, b: b / 255, a: a ?? 1 };
}

/** Create a solid paint. */
export function solid(
  hex: string,
  opts?: { blendMode?: string; visible?: boolean; opacity?: number },
): any {
  const rgba = parseHexToRGBA(hex);
  const paint: any = {
    type: 'SOLID',
    color: { r: rgba.r, g: rgba.g, b: rgba.b },
    opacity: rgba.a,
  };
  if (opts) {
    if (opts.opacity !== undefined) paint.opacity = opts.opacity;
    if (opts.blendMode) paint.blendMode = opts.blendMode;
    if (opts.visible !== undefined) paint.visible = opts.visible;
  }
  return paint;
}

// ── Gradient Transform (ported from gradient-parser.ts) ──────────────────

type Transform2D = [[number, number, number], [number, number, number]];

/**
 * Convert CSS angle to Figma gradient transform matrix.
 * CSS: 0deg = to top, 90deg = to right (clockwise).
 */
export function cssAngleToGradientTransform(angleDeg: number): Transform2D {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const length = Math.abs(dx) + Math.abs(dy);
  const startX = 0.5 - (dx / length) * 0.5;
  const startY = 0.5 - (dy / length) * 0.5;
  const endX = 0.5 + (dx / length) * 0.5;
  const endY = 0.5 + (dy / length) * 0.5;
  return [
    [endX - startX, -(endY - startY), startX],
    [endY - startY, endX - startX, startY],
  ];
}

type GradientStop = string | [string, number];

/**
 * Create a linear gradient paint.
 * Stops can be hex strings (auto-distributed) or [hex, position] tuples.
 *
 *   gradient(135, '#667eea', '#764ba2')
 *   gradient(135, ['#667eea', 0], ['#764ba2', 1])
 */
export function gradient(angleDeg: number, ...stops: GradientStop[]): any {
  if (stops.length < 2) {
    return {
      type: 'GRADIENT_LINEAR',
      gradientStops: [],
      gradientTransform: cssAngleToGradientTransform(angleDeg),
    };
  }
  const resolved = stops.map((s, i, arr) => {
    if (typeof s === 'string') {
      return {
        color: parseHexToRGBA(s),
        position: i / (arr.length - 1),
      };
    }
    return { color: parseHexToRGBA(s[0]), position: s[1] };
  });
  return {
    type: 'GRADIENT_LINEAR',
    gradientStops: resolved,
    gradientTransform: cssAngleToGradientTransform(angleDeg),
  };
}

/** Create a drop shadow effect. Use opts.type='inset' for inner shadow. */
export function shadow(
  x: number,
  y: number,
  blurRadius: number,
  spread: number,
  color: string,
  opts?: { type?: 'inset' | 'drop'; blendMode?: string },
): any {
  return {
    type: opts?.type === 'inset' ? 'INNER_SHADOW' : 'DROP_SHADOW',
    color: parseHexToRGBA(color),
    offset: { x, y },
    radius: blurRadius,
    spread,
    visible: true,
    blendMode: opts?.blendMode ?? 'NORMAL',
  };
}

/** Create a layer blur effect. */
export function blur(radius: number): any {
  return { type: 'LAYER_BLUR', radius, visible: true };
}

/** Create a background blur effect. */
export function bgblur(radius: number): any {
  return { type: 'BACKGROUND_BLUR', radius, visible: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 3: Design Shortcuts
// ═══════════════════════════════════════════════════════════════════════════

/** Column layout (vertical auto-layout). */
export function col(gap?: number): Record<string, any> {
  const result: Record<string, any> = { layoutMode: 'VERTICAL' };
  if (gap !== undefined) result.itemSpacing = gap;
  return result;
}

/** Row layout (horizontal auto-layout). */
export function row(gap?: number): Record<string, any> {
  const result: Record<string, any> = { layoutMode: 'HORIZONTAL' };
  if (gap !== undefined) result.itemSpacing = gap;
  return result;
}

/**
 * Padding shorthand (CSS convention):
 *   pad(all)         → 4 sides equal
 *   pad(v, h)        → vertical, horizontal
 *   pad(t, r, b, l)  → top, right, bottom, left
 */
export function pad(...args: number[]): Record<string, number> {
  switch (args.length) {
    case 1:
      return { paddingTop: args[0], paddingRight: args[0], paddingBottom: args[0], paddingLeft: args[0] };
    case 2:
      return { paddingTop: args[0], paddingRight: args[1], paddingBottom: args[0], paddingLeft: args[1] };
    case 3:
      return { paddingTop: args[0], paddingRight: args[1], paddingBottom: args[2], paddingLeft: args[1] };
    default:
      return { paddingTop: args[0], paddingRight: args[1], paddingBottom: args[2], paddingLeft: args[3] };
  }
}

/** Fill both axes. */
export function sizeFill(): Record<string, string> {
  return { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FILL' };
}

/** Hug both axes. */
export function sizeHug(): Record<string, string> {
  return { layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG' };
}

export function fillH(): Record<string, string> { return { layoutSizingHorizontal: 'FILL' }; }
export function fillV(): Record<string, string> { return { layoutSizingVertical: 'FILL' }; }
export function hugH(): Record<string, string> { return { layoutSizingHorizontal: 'HUG' }; }
export function hugV(): Record<string, string> { return { layoutSizingVertical: 'HUG' }; }

const ALIGN_MAP: Record<string, string> = {
  center: 'CENTER', start: 'MIN', end: 'MAX',
  between: 'SPACE_BETWEEN', baseline: 'BASELINE',
};

function mapAlign(v: string): string {
  return ALIGN_MAP[v.toLowerCase()] ?? v.toUpperCase();
}

/**
 * Alignment shorthand:
 *   align(cross)        → cross-axis only (most common: "vertically center")
 *   align(main, cross)  → both axes
 */
export function align(...args: string[]): Record<string, string> {
  if (args.length === 1) {
    return { counterAxisAlignItems: mapAlign(args[0]) };
  }
  return {
    primaryAxisAlignItems: mapAlign(args[0]),
    counterAxisAlignItems: mapAlign(args[1]),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Export Map (for injection into template execution context)
// ═══════════════════════════════════════════════════════════════════════════

/** All template bindings: names → values, for injection into Function scope. */
export const TEMPLATE_BINDINGS: Record<string, any> = {
  // Layer 1: Node types
  Frame, Text, Rectangle, Rect, Ellipse, Line, Star, Polygon,
  Vector, Group, Section, Component, Instance,
  BooleanOperation, ComponentSet, Icon, Image,
  // Layer 2: Compute
  hexToRgb, rgb, solid, gradient, shadow, blur, bgblur,
  // Layer 3: Design shortcuts
  col, row, pad, sizeFill, sizeHug, fillH, fillV, hugH, hugV, align,
};

/** Ordered names for Function constructor parameter list. */
export const TEMPLATE_BINDING_NAMES = Object.keys(TEMPLATE_BINDINGS);
/** Ordered values matching TEMPLATE_BINDING_NAMES. */
export const TEMPLATE_BINDING_VALUES = Object.values(TEMPLATE_BINDINGS);
