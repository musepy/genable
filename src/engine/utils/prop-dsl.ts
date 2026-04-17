/**
 * @file prop-dsl.ts
 * @description Shared DSL utilities — tag mapping, value coercion, helpers.
 *
 * Property name translation (abbreviations, CSS aliases) is handled by
 * expandShorthands.ts — the single source of truth for property expansion.
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
  component: 'FRAME',  // Alias — auto-sets reusable:true in parser
  delete: 'DELETE',
  ref: 'REF',
  variantset: 'VARIANT_SET',
  clone: 'CLONE',
};

// ═══════════════════════════════════════════════
// Value classification (for coerceValue)
// ═══════════════════════════════════════════════

const STRING_VALUE_PROPS = new Set([
  'fontWeight', 'fontFamily', 'name', 'characters',
  'layout', 'justifyContent', 'alignItems', 'background',
  'primaryAxisAlignItems', 'counterAxisAlignItems', 'textAlignHorizontal',
  'layoutPositioning', 'strokeAlign', 'iconName', 'layoutSizingHorizontal',
  'layoutSizingVertical', 'textAlignVertical', 'textAutoResize',
  'layoutWrap', 'component', 'constraints',
  'strokeJoin', 'strokeCap', 'blendMode', 'dashPattern',
  'textDecoration', 'textTruncation', 'fontStyle', 'scaleMode',
  // Abbreviations that must stay as strings
  'weight', 'font', 'alignMain', 'alignCross', 'justify', 'textAlign',
  'positioning', 'strokeA', 'strokeJ', 'strokeC', 'dash',
  'sizingH', 'sizingV', 'blend', 'wrap', 'pin', 'overflow',
  'decoration', 'whiteSpace', 'italic', 'fit', 'outline',
]);

const MIXED_VALUE_PROPS = new Set(['width', 'height', 'w', 'h']);

const NUMERIC_PROPS = new Set([
  'fontSize', 'cornerRadius', 'strokeWeight', 'itemSpacing', 'counterAxisSpacing',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'letterSpacing', 'lineHeight', 'opacity',
  'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight',
  'cornerSmoothing',
  'rotation', 'maxLines', 'fontSlant',
  // Abbreviations that are numeric
  'gap', 'crossGap', 'size', 'corner', 'smooth', 'strokeW',
  'pt', 'pr', 'pb', 'pl',
  'strokeT', 'strokeR', 'strokeB', 'strokeL',
  'minW', 'maxW', 'minH', 'maxH',
  'rotate', 'slant',
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
