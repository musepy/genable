/**
 * @file prop-dsl.ts
 * @description Shared DSL utilities for property parsing — abbreviation expansion,
 * value coercion, padding expansion, symbol helpers.
 *
 * Consumed by both flatOpsParser and xml-interpreter.
 * Extracted to decouple shared logic from the (now legacy) XML interpreter.
 */

// ═══════════════════════════════════════════════
// Tag → Figma Type Mapping
// ═══════════════════════════════════════════════

export const TAG_TO_TYPE: Record<string, string> = {
  frame: 'FRAME',
  text: 'TEXT',
  rect: 'RECTANGLE',
  rectangle: 'RECTANGLE',
  ellipse: 'ELLIPSE',
  line: 'LINE',
  icon: 'ICON',
  image: 'IMAGE',
  group: 'GROUP',
  section: 'SECTION',
  vector: 'VECTOR',
  delete: 'DELETE',
  ref: 'REF',
};

// ═══════════════════════════════════════════════
// Abbreviation Expansion
// ═══════════════════════════════════════════════

export const ABBREV_EXPANSION: Record<string, string> = {
  w: 'width',
  h: 'height',
  size: 'fontSize',
  weight: 'fontWeight',
  font: 'fontFamily',
  corner: 'cornerRadius',
  strokeW: 'strokeWeight',
  pt: 'paddingTop',
  pr: 'paddingRight',
  pb: 'paddingBottom',
  pl: 'paddingLeft',
  alignMain: 'primaryAxisAlignItems',
  alignCross: 'counterAxisAlignItems',
  textAlign: 'textAlignHorizontal',
  positioning: 'layoutPositioning',
  tracking: 'letterSpacing',
  leading: 'lineHeight',
  strokeA: 'strokeAlign',
  strokeJ: 'strokeJoin',
  strokeC: 'strokeCap',
  dash: 'dashPattern',
  strokeT: 'strokeTopWeight',
  strokeR: 'strokeRightWeight',
  strokeB: 'strokeBottomWeight',
  strokeL: 'strokeLeftWeight',
  blend: 'blendMode',
  smooth: 'cornerSmoothing',
  bg: 'background',
  sizingH: 'layoutSizingHorizontal',
  sizingV: 'layoutSizingVertical',
  overflow: 'clipsContent',
  wrap: 'layoutWrap',
  strokesInLayout: 'strokesIncludedInLayout',
  reverseZ: 'itemReverseZIndex',
  lockRatio: 'constrainProportions',
  pin: 'constraints',
  minW: 'minWidth',
  maxW: 'maxWidth',
  minH: 'minHeight',
  maxH: 'maxHeight',
};

// ═══════════════════════════════════════════════
// Value classification
// ═══════════════════════════════════════════════

const STRING_VALUE_PROPS = new Set([
  'fontWeight', 'fontFamily', 'name', 'characters',
  'layout', 'layoutMode', 'justifyContent', 'alignItems', 'background',
  'primaryAxisAlignItems', 'counterAxisAlignItems', 'textAlignHorizontal',
  'layoutPositioning', 'strokeAlign', 'iconName', 'layoutSizingHorizontal',
  'layoutSizingVertical', 'textAlignVertical', 'textAutoResize',
  'layoutWrap', 'component', 'constraints',
  'strokeJoin', 'strokeCap', 'blendMode', 'dashPattern',
]);

const MIXED_VALUE_PROPS = new Set(['width', 'height']);

const NUMERIC_PROPS = new Set([
  'fontSize', 'cornerRadius', 'strokeWeight', 'itemSpacing', 'gap',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'letterSpacing', 'lineHeight', 'opacity',
  'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight',
  'cornerSmoothing',
]);

/** Properties that use the unitValue spec (lineHeight, letterSpacing) */
export const UNIT_VALUE_PROPS = new Set(['lineHeight', 'letterSpacing']);

// ═══════════════════════════════════════════════
// Value coercion
// ═══════════════════════════════════════════════

export function coerceValue(key: string, value: string): string | number | boolean {
  if (STRING_VALUE_PROPS.has(key)) return value;
  // Boolean coercion — before numeric, so "true"/"false" don't fall through
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (MIXED_VALUE_PROPS.has(key)) {
    if (value.endsWith('%')) return value;
    const n = parseFloat(value);
    return isNaN(n) ? value : n;
  }
  if (NUMERIC_PROPS.has(key)) {
    if (key === 'lineHeight' && value.endsWith('%')) return value;
    const n = parseFloat(value);
    return isNaN(n) ? value : n;
  }
  const n = parseFloat(value);
  if (!isNaN(n) && String(n) === value) return n;
  return value;
}

// ═══════════════════════════════════════════════
// Special format parsers
// ═══════════════════════════════════════════════

export function expandPadding(value: string): Record<string, number> {
  const parts = value.trim().split(/\s+/).map(Number);
  switch (parts.length) {
    case 1:
      return { paddingTop: parts[0], paddingRight: parts[0], paddingBottom: parts[0], paddingLeft: parts[0] };
    case 2:
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[0], paddingLeft: parts[1] };
    case 4:
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[2], paddingLeft: parts[3] };
    default:
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[2], paddingLeft: parts[1] };
  }
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

export function toCamelCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

export function computeDependsOn(parentRef?: string): string[] {
  if (!parentRef) return [];
  if (parentRef.includes(':')) return [];
  return [parentRef];
}
