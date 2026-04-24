/**
 * @file prop-dsl.ts
 * @description Shared DSL utilities — tag mapping, value coercion, helpers.
 *
 * Property name translation (abbreviations, CSS aliases) is handled by
 * expandShorthands.ts — the single source of truth for property expansion.
 */

import { PROPERTY_REGISTRY } from '../../constants/figma-property-registry';

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
//
// Derivation: base sets are built at module load from PROPERTY_REGISTRY by
// `valueType`, then UNIONed with DSL-layer entries below. Registry-derived
// strings now include both `valueType: 'string'` AND `valueType: 'enum'` —
// after Phase 5 the extractor detects string-literal unions and tags them
// explicitly, so most enum-shaped canonical keys no longer need hand-listing.
//
// Two kinds of DSL entries remain:
//   1. Abbreviation aliases (weight, font, gap, p, …) — not Figma API keys.
//   2. A handful of canonical keys that registry still types as 'object'
//      because Figma declares them as references or objects (e.g. fontWeight
//      is `number | mixed`, fontFamily/fontStyle come through `fontName`,
//      dashPattern is `number[]`, constraints is `{horizontal, vertical}`).
//
// When adding a new Figma prop:
//   - If registry's `valueType` is 'number', 'string', or 'enum' → it's
//     auto-picked up, no change needed here.
//   - If registry's `valueType` is 'object' but the prop is semantically an
//     enum/string → add to DSL_STRING_ALIASES below. If it's a string-literal
//     union, also check why the extractor's enum detector missed it.

/** DSL-only keys (abbreviations, CSS aliases) + a small residue of canonical
 *  keys still typed `object` in the registry (fontWeight's `number | mixed`,
 *  constraints' `{horizontal, vertical}` object, dashPattern's `number[]`,
 *  iconName/scaleMode which live outside the core registry). All treated as
 *  strings by coerceValue to prevent accidental numeric coercion. */
const DSL_STRING_ALIASES = new Set([
  // Canonical registry keys that are NOT string-literal unions but should
  // still be coerced as strings (numeric-with-mixed, object shapes, non-registry).
  'fontWeight', 'fontFamily', 'fontStyle',
  'layout', 'justifyContent', 'alignItems', 'background',
  'iconName',
  'component', 'constraints',
  'dashPattern',
  'scaleMode',
  // DSL abbreviations that must stay as strings
  'weight', 'font', 'alignMain', 'alignCross', 'justify', 'items', 'textAlign',
  'positioning', 'strokeA', 'strokeJ', 'strokeC', 'dash',
  'blend', 'wrap', 'pin', 'overflow',
  'decoration', 'whiteSpace', 'italic', 'fit', 'outline',
]);

/** DSL-only numeric keys (abbreviations, CSS aliases) + canonical keys the
 *  registry types as 'object' because Figma's API accepts `number | {value,unit}`
 *  for mixed-state. When coerceValue sees a raw string from the DSL parser,
 *  these should parse as numbers. */
const DSL_NUMERIC_ALIASES = new Set([
  // Canonical 'object'-typed (mixed-capable) numeric keys
  'fontSize', 'cornerRadius', 'strokeWeight',
  'letterSpacing', 'lineHeight',
  // `fontSlant` is not a Figma API key — kept as a DSL compat alias emitted by
  // expandShorthands' `slant` transform. If Figma ever ships a real fontSlant
  // property, we should add it to the registry and delete this line.
  'fontSlant',
  // DSL abbreviations that are numeric
  'gap', 'crossGap', 'size', 'corner', 'rounded', 'smooth', 'strokeW',
  'pt', 'pr', 'pb', 'pl',
  'strokeT', 'strokeR', 'strokeB', 'strokeL',
  'minW', 'maxW', 'minH', 'maxH',
  'rotate', 'slant',
]);

/** Build registry-derived base sets at module load. `'enum'` joins `'string'`
 *  on the string side — enum values ("MIN", "SPACE_BETWEEN", "CENTER", …) must
 *  stay as strings through coerceValue or they'd parse to NaN. */
function collectRegistryKeysByType(): { strings: Set<string>; numbers: Set<string> } {
  const strings = new Set<string>();
  const numbers = new Set<string>();
  for (const nodeType of Object.keys(PROPERTY_REGISTRY)) {
    for (const entry of PROPERTY_REGISTRY[nodeType]) {
      if (entry.valueType === 'string' || entry.valueType === 'enum') strings.add(entry.key);
      else if (entry.valueType === 'number') numbers.add(entry.key);
    }
  }
  return { strings, numbers };
}

const REGISTRY_KEYS = collectRegistryKeysByType();

/** Final sets used by coerceValue — registry-derived base ∪ DSL aliases. */
const STRING_VALUE_PROPS: ReadonlySet<string> = new Set([
  ...REGISTRY_KEYS.strings,
  ...DSL_STRING_ALIASES,
]);

const MIXED_VALUE_PROPS = new Set(['width', 'height', 'w', 'h']);

const NUMERIC_PROPS: ReadonlySet<string> = new Set([
  ...REGISTRY_KEYS.numbers,
  ...DSL_NUMERIC_ALIASES,
].filter((k) => !MIXED_VALUE_PROPS.has(k))); // width/height carry mixed semantics

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
