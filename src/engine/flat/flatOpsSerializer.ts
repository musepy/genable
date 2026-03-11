/**
 * @file flatOpsSerializer.ts
 * @description Converts NodeLayer trees to flat-ops-style text for LLM consumption.
 *
 * Output mirrors the flat ops write format so the LLM reads and writes
 * in the same vocabulary:
 *
 *   frame('id', {name:'Card', layout:'column', gap:16, w:500, sizingV:'hug', p:24, fill:'#FFFFFF'})
 *     text('id', {name:'Title', size:18, fill:'#111827', w:452, sizingH:'fill'}, 'Hello')
 *
 * Mixed properties (from range-level styles) are rendered as unquoted `mixed` keyword.
 */

import type { NodeLayer } from '../../schema/layerSchema';
import { paintSpec, effectSpec, constraintsSpec } from '../../domain/property-specs';

// ── Constants ──

const MAX_DEPTH = 4;
const MAX_CHILDREN = 15;

const MIXED = 'mixed';

/** Properties worth serializing for LLM inspection (full mode). */
const INSPECT_PROPS = new Set([
  'name', 'fills', 'strokes', 'layoutMode', 'gap', 'padding',
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
  'constrainProportions',
  'constraints',
]);

/** Abbreviations aligned with flatOpsParser's ABBREV_EXPANSION (inverse). */
const ATTR_ABBREV: Record<string, string> = {
  layoutMode: 'layout',
  width: 'w',
  height: 'h',
  layoutSizingHorizontal: 'sizingH',
  layoutSizingVertical: 'sizingV',
  primaryAxisAlignItems: 'alignMain',
  counterAxisAlignItems: 'alignCross',
  cornerRadius: 'corner',
  strokeWeight: 'strokeW',
  paddingTop: 'pt',
  paddingRight: 'pr',
  paddingBottom: 'pb',
  paddingLeft: 'pl',
  fontWeight: 'weight',
  fontSize: 'size',
  fontFamily: 'font',
  textAlignHorizontal: 'textAlign',
  layoutPositioning: 'positioning',
  letterSpacing: 'tracking',
  lineHeight: 'leading',
  strokeAlign: 'strokeA',
  strokeJoin: 'strokeJ',
  strokeCap: 'strokeC',
  dashPattern: 'dash',
  strokeTopWeight: 'strokeT',
  strokeRightWeight: 'strokeR',
  strokeBottomWeight: 'strokeB',
  strokeLeftWeight: 'strokeL',
  blendMode: 'blend',
  cornerSmoothing: 'smooth',
  iconName: 'icon',
  clipsContent: 'overflow',
  layoutWrap: 'wrap',
  strokesIncludedInLayout: 'strokesInLayout',
  itemReverseZIndex: 'reverseZ',
  minWidth: 'minW',
  maxWidth: 'maxW',
  minHeight: 'minH',
  maxHeight: 'maxH',
  constrainProportions: 'lockRatio',
  constraints: 'pin',
};

/** NodeLayer type → compact tag name. */
const TAG_MAP: Record<string, string> = {
  FRAME: 'frame',
  TEXT: 'text',
  RECTANGLE: 'rect',
  VECTOR: 'vector',
  LINE: 'line',
  ELLIPSE: 'ellipse',
  GROUP: 'group',
  SECTION: 'section',
  ICON: 'icon',
};

/** Figma-native enum → CSS-friendly (same vocab the LLM writes). */
const FIGMA_TO_CSS: Record<string, Record<string, string>> = {
  layoutMode:            { VERTICAL: 'column', HORIZONTAL: 'row' },
  primaryAxisAlignItems: { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' },
  counterAxisAlignItems: { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' },
  layoutSizingHorizontal: { FILL: 'fill', HUG: 'hug' },
  layoutSizingVertical:   { FILL: 'fill', HUG: 'hug' },
  textAlignHorizontal:    { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justified' },
  strokeAlign:            { INSIDE: 'inside', OUTSIDE: 'outside', CENTER: 'center' },
  strokeJoin:             { MITER: 'miter', BEVEL: 'bevel', ROUND: 'round' },
  strokeCap:              { NONE: 'none', ROUND: 'round', SQUARE: 'square', ARROW_LINES: 'arrow-lines', ARROW_EQUILATERAL: 'arrow-equilateral' },
  layoutWrap:             { WRAP: 'wrap' },
};

/** Default values — skip to reduce noise. */
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

/** Properties included in structural mode (skeleton only). */
const STRUCTURAL_PROPS = new Set([
  'name', 'width', 'height', 'layoutMode',
  'layoutSizingHorizontal', 'layoutSizingVertical',
  'x', 'y',
]);

/** Max inline text length in structural mode before collapsing to chars:N. */
const STRUCTURAL_TEXT_INLINE_MAX = 30;

// ── Helpers ──

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatFills(fills: any[]): { attr: string; value: string } | null {
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

  if (irPaints.length === 1) return { attr: 'fill', value: formatted };
  return { attr: 'fills', value: formatted };
}

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

function formatEffects(effects: any[]): string | null {
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

function compactPadding(props: Record<string, any>): [string, string] | null {
  const t = props.paddingTop ?? 0;
  const r = props.paddingRight ?? 0;
  const b = props.paddingBottom ?? 0;
  const l = props.paddingLeft ?? 0;

  if (t === 0 && r === 0 && b === 0 && l === 0) return null;
  if (t === r && r === b && b === l) return ['p', String(t)];
  if (t === b && r === l) return ['p', `${t} ${r}`];
  return ['p', `${t} ${r} ${b} ${l}`];
}

/** Format a value for flat ops output: numbers unquoted, strings single-quoted, 'mixed' unquoted. */
function fmtVal(value: any): string {
  if (value === MIXED) return 'mixed';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${escapeText(String(value))}'`;
}

// ── Core serializer ──

export interface FlatOpsSerializeOptions {
  maxDepth?: number;
  maxChildren?: number;
  /** Structural mode: only id, name, type, w, h, layout. Skips fills/fonts/effects/padding. */
  structural?: boolean;
}

export class FlatOpsSerializer {
  static serialize(node: NodeLayer, options?: FlatOpsSerializeOptions): string {
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
  ): string {
    const tag = TAG_MAP[node.type] || 'frame';
    const props = (node.props || {}) as Record<string, any>;
    const indent = '  '.repeat(depth);

    // Build {key:value} pairs
    const pairs: string[] = [];

    // name always first
    if (props.name) pairs.push(`name:${fmtVal(props.name)}`);

    if (structural) {
      this.addStructuralProps(pairs, props);
    } else {
      this.addFullProps(pairs, props);
    }

    // Truncation markers
    const layerAny = node as any;
    if (layerAny._truncated) pairs.push('_truncated:true');
    if (layerAny._childCount) pairs.push(`_childCount:${layerAny._childCount}`);

    // Text content
    const characters = props.characters;
    let textArg = '';
    if (tag === 'text' && characters) {
      const charStr = String(characters);
      if (structural && charStr.length > STRUCTURAL_TEXT_INLINE_MAX) {
        pairs.push(`chars:${charStr.length}`);
      } else {
        textArg = `, '${escapeText(charStr)}'`;
      }
    }

    const propsStr = pairs.length > 0 ? `{${pairs.join(', ')}}` : '{}';
    const head = `${indent}${tag}('${node.id}', ${propsStr}${textArg})`;

    // Children
    const children = node.children;
    const hasChildren = children && children.length > 0 && depth < maxDepth;

    if (!hasChildren) return head;

    const lines: string[] = [head];
    const serialized = children!.slice(0, maxChildren);
    const truncatedCount = children!.length - serialized.length;

    for (const child of serialized) {
      lines.push(this.serializeNode(child, depth + 1, maxDepth, maxChildren, structural));
    }

    if (truncatedCount > 0 || layerAny._moreChildren) {
      const moreCount = truncatedCount + (layerAny._moreChildren || 0);
      lines.push(`${indent}  // +${moreCount} more`);
    }

    return lines.join('\n');
  }

  private static addStructuralProps(pairs: string[], props: Record<string, any>): void {
    for (const key of STRUCTURAL_PROPS) {
      if (key === 'name') continue;
      const value = props[key];
      if (value === undefined || value === null) continue;
      if (value === MIXED) { pairs.push(`${ATTR_ABBREV[key] || key}:mixed`); continue; }
      if (key in DEFAULTS && value === DEFAULTS[key]) continue;
      const attrName = ATTR_ABBREV[key] || key;
      const cssMap = FIGMA_TO_CSS[key];
      const displayValue = cssMap ? (cssMap[String(value)] ?? String(value)) : value;
      pairs.push(`${attrName}:${fmtVal(displayValue)}`);
    }
  }

  private static addFullProps(pairs: string[], props: Record<string, any>): void {
    // Compact padding
    const hasPaddingProps = props.paddingTop !== undefined || props.paddingRight !== undefined ||
      props.paddingBottom !== undefined || props.paddingLeft !== undefined;
    const paddingResult = hasPaddingProps ? compactPadding(props) : null;
    const paddingConsumed = new Set<string>();
    if (paddingResult) {
      paddingConsumed.add('paddingTop');
      paddingConsumed.add('paddingRight');
      paddingConsumed.add('paddingBottom');
      paddingConsumed.add('paddingLeft');
    }

    // Fills/strokes — handle specially or mark mixed
    const fillsMixed = props.fills === MIXED;
    const strokesMixed = props.strokes === MIXED;
    const fillResult = fillsMixed ? null : formatFills(props.fills);
    const strokeResult = strokesMixed ? null : formatFills(props.strokes);

    // Effects
    const effectsMixed = props.effects === MIXED;
    const effectStr = effectsMixed ? null : formatEffects(props.effects);

    // Iterate INSPECT_PROPS
    for (const key of INSPECT_PROPS) {
      if (key === 'name' || key === 'characters') continue;
      if (key === 'fills' || key === 'strokes' || key === 'effects') continue;
      if (paddingConsumed.has(key)) continue;

      const value = props[key];
      if (value === undefined || value === null) continue;

      // Mixed sentinel
      if (value === MIXED) {
        pairs.push(`${ATTR_ABBREV[key] || key}:mixed`);
        continue;
      }

      if (key in DEFAULTS && value === DEFAULTS[key]) continue;

      // Suppress per-side stroke weights when they all match strokeWeight (uniform stroke)
      if ((key === 'strokeTopWeight' || key === 'strokeRightWeight' || key === 'strokeBottomWeight' || key === 'strokeLeftWeight')) {
        const sw = props.strokeWeight;
        if (sw !== undefined && sw !== MIXED && value === sw) continue;
      }

      // clipsContent → overflow semantics
      if (key === 'clipsContent') {
        pairs.push(`${ATTR_ABBREV[key] || key}:${fmtVal(value ? 'hidden' : 'visible')}`);
        continue;
      }

      // dashPattern → compact "10,5" format
      if (key === 'dashPattern' && Array.isArray(value)) {
        if (value.length > 0) {
          pairs.push(`${ATTR_ABBREV[key] || key}:${fmtVal(value.join(','))}`);
        }
        continue;
      }

      // constraints → compact "H,V" format
      if (key === 'constraints' && typeof value === 'object') {
        const ir = constraintsSpec.fromFigma(value);
        const defaultIr = constraintsSpec.defaultValue!;
        if (!constraintsSpec.isEqual(ir, defaultIr)) {
          pairs.push(`${ATTR_ABBREV[key] || key}:${fmtVal(constraintsSpec.formatXml(ir))}`);
        }
        continue;
      }

      // Skip unhandled objects
      if (typeof value === 'object') continue;

      const attrName = ATTR_ABBREV[key] || key;
      const cssMap = FIGMA_TO_CSS[key];
      const displayValue = cssMap ? (cssMap[String(value)] ?? String(value)) : value;
      pairs.push(`${attrName}:${fmtVal(displayValue)}`);
    }

    // Padding
    if (paddingResult) pairs.push(`${paddingResult[0]}:${fmtVal(paddingResult[1])}`);

    // Fill/stroke/effects
    if (fillsMixed) pairs.push('fill:mixed');
    else if (fillResult) pairs.push(`${fillResult.attr}:${fmtVal(fillResult.value)}`);

    if (strokesMixed) pairs.push('stroke:mixed');
    else if (strokeResult) pairs.push(`stroke:${fmtVal(strokeResult.value)}`);

    if (effectsMixed) pairs.push('shadow:mixed');
    else if (effectStr) pairs.push(`shadow:${fmtVal(effectStr)}`);
  }
}
