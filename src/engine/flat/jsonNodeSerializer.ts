/**
 * @file jsonNodeSerializer.ts
 * @description Converts NodeLayer trees to JSON objects for LLM consumption.
 *
 * Design decisions (from read-json-format-spec.md):
 * - Properties directly on node (no `props` wrapper)
 * - Middle names: width (not w), fontSize (not size), radius (not corner)
 * - CSS enum values: row/column, flex-start/center
 * - Default values omitted
 * - Padding compacted: "24 16" or single number
 * - Single fill as string, multi-fill as array
 * - Truncation: children [..., "..."], _more: N
 * - Component/instance type info included
 */

import type { NodeLayer } from '../../schema/layerSchema';
import { paintSpec, effectSpec, constraintsSpec } from '../../domain/property-specs';

// ── Constants ──

const MAX_DEPTH = 4;
const MAX_CHILDREN = 15;
const MIXED = 'mixed';

/** Middle name mapping: Figma canonical → LLM-friendly middle name. */
const MIDDLE_NAMES: Record<string, string> = {
  layoutMode: 'layout',
  layoutSizingHorizontal: 'sizingH',
  layoutSizingVertical: 'sizingV',
  primaryAxisAlignItems: 'alignMain',
  counterAxisAlignItems: 'alignCross',
  cornerRadius: 'radius',
  itemSpacing: 'gap',
  counterAxisSpacing: 'crossGap',
  characters: 'content',
  textAlignHorizontal: 'textAlign',
  layoutPositioning: 'positioning',
  clipsContent: 'overflow',
  layoutWrap: 'wrap',
  strokesIncludedInLayout: 'strokesInLayout',
  itemReverseZIndex: 'reverseZ',
  constrainProportions: 'lockRatio',
  constraints: 'pin',
};

/** Figma enum → CSS-friendly value. */
const ENUM_TO_CSS: Record<string, Record<string, string>> = {
  layoutMode:              { VERTICAL: 'column', HORIZONTAL: 'row' },
  primaryAxisAlignItems:   { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' },
  counterAxisAlignItems:   { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' },
  layoutSizingHorizontal:  { FILL: 'fill', HUG: 'hug' },
  layoutSizingVertical:    { FILL: 'fill', HUG: 'hug' },
  textAlignHorizontal:     { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justified' },
  strokeAlign:             { INSIDE: 'inside', OUTSIDE: 'outside', CENTER: 'center' },
  strokeJoin:              { MITER: 'miter', BEVEL: 'bevel', ROUND: 'round' },
  strokeCap:               { NONE: 'none', ROUND: 'round', SQUARE: 'square' },
  layoutWrap:              { WRAP: 'wrap' },
};

/** Default values — skip when equal. */
const DEFAULTS: Record<string, any> = {
  layoutMode: 'NONE',
  layoutSizingHorizontal: 'FIXED',
  layoutSizingVertical: 'FIXED',
  primaryAxisAlignItems: 'MIN',
  counterAxisAlignItems: 'MIN',
  cornerRadius: 0,
  strokeWeight: 0,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  gap: 0,
  opacity: 1,
  visible: true,
  layoutPositioning: 'AUTO',
  x: 0,
  y: 0,
  strokeAlign: 'INSIDE',
  strokeJoin: 'MITER',
  strokeCap: 'NONE',
  blendMode: 'PASS_THROUGH',
  cornerSmoothing: 0,
  strokeTopWeight: 0,
  strokeRightWeight: 0,
  strokeBottomWeight: 0,
  strokeLeftWeight: 0,
  letterSpacing: 0,
  clipsContent: false,
  layoutWrap: 'NO_WRAP',
  strokesIncludedInLayout: false,
  itemReverseZIndex: false,
  constrainProportions: false,
};

/** Properties to include in full mode. */
const INCLUDE_PROPS = new Set([
  'name', 'fills', 'strokes', 'layoutMode', 'gap',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontSize', 'fontWeight', 'fontFamily', 'characters', 'cornerRadius',
  'width', 'height', 'layoutSizingHorizontal', 'layoutSizingVertical',
  'primaryAxisAlignItems', 'counterAxisAlignItems',
  'opacity', 'visible', 'effects', 'strokeWeight', 'strokeAlign',
  'strokeJoin', 'strokeCap', 'dashPattern',
  'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight',
  'blendMode', 'cornerSmoothing',
  'textAlignHorizontal', 'lineHeight', 'letterSpacing',
  'layoutPositioning', 'x', 'y', 'iconName',
  'clipsContent', 'layoutWrap',
  'strokesIncludedInLayout', 'itemReverseZIndex',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'constrainProportions', 'constraints',
]);

/** Properties for structural (skeleton) mode. */
const STRUCTURAL_PROPS = new Set([
  'name', 'width', 'height', 'layoutMode',
  'layoutSizingHorizontal', 'layoutSizingVertical',
  'x', 'y',
]);

// ── Tag mapping ──

const TAG_MAP: Record<string, string> = {
  FRAME: 'frame',
  TEXT: 'text',
  RECTANGLE: 'rect',
  VECTOR: 'vector',
  LINE: 'line',
  ELLIPSE: 'ellipse',
  GROUP: 'frame',
  SECTION: 'frame',
  ICON: 'icon',
};

// ── Helpers ──

function parseHexForSpec(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  if (clean.length >= 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16) / 255,
      g: parseInt(clean.slice(2, 4), 16) / 255,
      b: parseInt(clean.slice(4, 6), 16) / 255,
    };
  }
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) / 255,
      g: parseInt(clean[1] + clean[1], 16) / 255,
      b: parseInt(clean[2] + clean[2], 16) / 255,
    };
  }
  return { r: 0, g: 0, b: 0 };
}

function formatFillsJson(fills: any[]): { key: string; value: any } | null {
  if (!fills || !Array.isArray(fills) || fills.length === 0) return null;

  const normalized = fills.map((f: any) => {
    if (typeof f === 'string') {
      return { type: 'SOLID', color: parseHexForSpec(f), opacity: 1 };
    }
    if (f && typeof f === 'object' && f.stops && !f.gradientStops) {
      return { ...f, gradientStops: f.stops.map((s: any) => ({
        color: typeof s.color === 'string' ? parseHexForSpec(s.color) : (s.color || { r: 0, g: 0, b: 0, a: 1 }),
        position: s.position ?? 0,
      }))};
    }
    return f;
  });

  const irPaints = paintSpec.fromFigma(normalized);
  if (irPaints.length === 0) return null;

  const formatted = paintSpec.formatXml(irPaints);
  if (formatted === 'transparent') return null;

  // Single solid → string, multiple → array
  if (irPaints.length === 1 && irPaints[0].kind === 'solid') {
    return { key: 'fill', value: formatted };
  }
  return { key: 'fills', value: formatted.split(',').map(s => s.trim()) };
}

function formatEffectsJson(effects: any[]): string | null {
  if (!effects || !Array.isArray(effects) || effects.length === 0) return null;
  const normalized = effects.map((e: any) => {
    const n = { ...e };
    if ('blur' in n && !('radius' in n)) n.radius = n.blur;
    if (typeof n.color === 'string') {
      const parsed = parseHexForSpec(n.color);
      const hex = n.color.replace('#', '');
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      n.color = { ...parsed, a };
    }
    return n;
  });
  const irEffects = effectSpec.fromFigma(normalized);
  if (irEffects.length === 0) return null;
  return effectSpec.formatXml(irEffects);
}

function compactPaddingJson(props: Record<string, any>): any | null {
  const t = props.paddingTop ?? 0;
  const r = props.paddingRight ?? 0;
  const b = props.paddingBottom ?? 0;
  const l = props.paddingLeft ?? 0;
  if (t === 0 && r === 0 && b === 0 && l === 0) return null;
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

// ── Core ──

export interface JsonSerializeOptions {
  maxDepth?: number;
  maxChildren?: number;
  /** Structural mode: only name, layout, dimensions. */
  structural?: boolean;
}

export class JsonNodeSerializer {
  static serialize(node: NodeLayer, options?: JsonSerializeOptions): any {
    const maxDepth = options?.maxDepth ?? MAX_DEPTH;
    const maxChildren = options?.maxChildren ?? MAX_CHILDREN;
    const structural = options?.structural ?? false;
    return this.serializeNode(node, 0, maxDepth, maxChildren, structural);
  }

  private static serializeNode(
    node: NodeLayer,
    depth: number,
    maxDepth: number,
    maxChildren: number,
    structural: boolean,
  ): any {
    const tag = TAG_MAP[node.type] || 'frame';
    const props = (node.props || {}) as Record<string, any>;
    const layerAny = node as any;

    // Build JSON object — type and id first, then properties flat
    const result: any = { type: tag, id: node.id };

    // Component/instance detection
    if (node.type === 'COMPONENT' as any) {
      result.type = 'component';
    } else if (node.type === 'INSTANCE' as any) {
      result.type = 'instance';
      // component and variant info would be in props if serialized
    } else if (node.type === 'COMPONENT_SET' as any) {
      result.type = 'componentSet';
    }

    // Name always first property
    if (props.name) result.name = props.name;

    // Add properties
    if (structural) {
      this.addStructuralProps(result, props);
    } else {
      this.addFullProps(result, props, tag);
    }

    // Text content — use "content" instead of "characters"
    if (tag === 'text' && props.characters) {
      const charStr = String(props.characters);
      if (structural && charStr.length > 30) {
        result._contentLength = charStr.length;
      } else {
        result.content = charStr;
      }
    }

    // Truncation markers
    if (layerAny._truncated) result._truncated = true;
    if (layerAny._childCount) result._childCount = layerAny._childCount;

    // Children
    const children = node.children;
    const hasChildren = children && children.length > 0 && depth < maxDepth;

    if (hasChildren) {
      const serialized = children!.slice(0, maxChildren);
      const truncatedCount = children!.length - serialized.length + (layerAny._moreChildren || 0);

      result.children = serialized.map((child: NodeLayer) =>
        this.serializeNode(child, depth + 1, maxDepth, maxChildren, structural)
      );

      if (truncatedCount > 0) {
        result.children.push('...');
        result._more = truncatedCount;
      }
    }

    return result;
  }

  private static addStructuralProps(result: any, props: Record<string, any>): void {
    for (const key of STRUCTURAL_PROPS) {
      if (key === 'name') continue;
      const value = props[key];
      if (value === undefined || value === null) continue;
      if (value === MIXED) { result[MIDDLE_NAMES[key] || key] = 'mixed'; continue; }
      if (key in DEFAULTS && value === DEFAULTS[key]) continue;

      const outKey = MIDDLE_NAMES[key] || key;
      const cssMap = ENUM_TO_CSS[key];
      result[outKey] = cssMap ? (cssMap[String(value)] ?? value) : value;
    }
  }

  private static addFullProps(result: any, props: Record<string, any>, tag: string): void {
    // Compact padding
    const hasPaddingProps = props.paddingTop !== undefined || props.paddingRight !== undefined ||
      props.paddingBottom !== undefined || props.paddingLeft !== undefined;
    const paddingValue = hasPaddingProps ? compactPaddingJson(props) : null;
    const paddingConsumed = new Set(['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']);

    // Fills/strokes
    const fillsMixed = props.fills === MIXED;
    const strokesMixed = props.strokes === MIXED;
    const fillResult = fillsMixed ? null : formatFillsJson(props.fills);
    const strokeResult = strokesMixed ? null : formatFillsJson(props.strokes);

    // Effects
    const effectsMixed = props.effects === MIXED;
    const effectStr = effectsMixed ? null : formatEffectsJson(props.effects);

    // Iterate properties
    for (const key of INCLUDE_PROPS) {
      if (key === 'name' || key === 'characters') continue;
      if (key === 'fills' || key === 'strokes' || key === 'effects') continue;
      if (paddingConsumed.has(key)) continue;

      const value = props[key];
      if (value === undefined || value === null) continue;

      if (value === MIXED) {
        result[MIDDLE_NAMES[key] || key] = 'mixed';
        continue;
      }

      if (key in DEFAULTS && value === DEFAULTS[key]) continue;

      // Suppress uniform per-side stroke weights
      if ((key === 'strokeTopWeight' || key === 'strokeRightWeight' || key === 'strokeBottomWeight' || key === 'strokeLeftWeight')) {
        const sw = props.strokeWeight;
        if (sw !== undefined && sw !== MIXED && value === sw) continue;
      }

      // clipsContent → overflow semantics
      if (key === 'clipsContent') {
        result.overflow = value ? 'hidden' : 'visible';
        continue;
      }

      // dashPattern → compact format
      if (key === 'dashPattern' && Array.isArray(value)) {
        if (value.length > 0) result.dashPattern = value;
        continue;
      }

      // constraints → compact format
      if (key === 'constraints' && typeof value === 'object') {
        const ir = constraintsSpec.fromFigma(value);
        const defaultIr = constraintsSpec.defaultValue!;
        if (!constraintsSpec.isEqual(ir, defaultIr)) {
          result.pin = constraintsSpec.formatXml(ir);
        }
        continue;
      }

      // Skip unhandled objects
      if (typeof value === 'object') continue;

      const outKey = MIDDLE_NAMES[key] || key;
      const cssMap = ENUM_TO_CSS[key];
      result[outKey] = cssMap ? (cssMap[String(value)] ?? value) : value;
    }

    // Padding
    if (paddingValue !== null) result.padding = paddingValue;

    // Fills
    if (fillsMixed) result.fill = 'mixed';
    else if (fillResult) result[fillResult.key] = fillResult.value;

    // Strokes
    if (strokesMixed) result.stroke = 'mixed';
    else if (strokeResult) result.stroke = strokeResult.value;

    // Effects
    if (effectsMixed) result.shadow = 'mixed';
    else if (effectStr) result.shadow = effectStr;
  }
}
