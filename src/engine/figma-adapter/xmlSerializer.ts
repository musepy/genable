/**
 * @file xmlSerializer.ts
 * @description Converts NodeLayer trees to compact XML for LLM consumption.
 *
 * XML is 60-70% smaller than equivalent JSON for design trees.
 * Built-in property filtering + depth/children limits (aligned with ToolResultCleaner).
 */

import type { NodeLayer } from '../../schema/layerSchema';
import { paintSpec, effectSpec } from '../../domain/property-specs';

// ── Constants ──

const MAX_DEPTH = 4;
const MAX_CHILDREN = 15;

/** Properties worth serializing for LLM inspection. */
const INSPECT_PROPS = new Set([
  'name', 'fills', 'strokes', 'layoutMode', 'gap', 'padding',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontSize', 'fontWeight', 'fontFamily', 'characters', 'cornerRadius',
  'width', 'height', 'layoutSizingHorizontal', 'layoutSizingVertical',
  'primaryAxisAlignItems', 'counterAxisAlignItems',
  'opacity', 'visible', 'effects', 'strokeWeight', 'strokeAlign',
  'textAlignHorizontal', 'lineHeight', 'letterSpacing',
  'layoutPositioning', 'x', 'y', 'iconName',
  'clipsContent', 'layoutWrap',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
]);

/** Attribute name abbreviations to shrink XML output. */
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
  iconName: 'icon',
  clipsContent: 'overflow',
  layoutWrap: 'wrap',
  minWidth: 'minW',
  maxWidth: 'maxW',
  minHeight: 'minH',
  maxHeight: 'maxH',
};

/** NodeLayer type → compact XML tag name. */
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

/**
 * Reverse mapping: Figma-native enum values → CSS-friendly values.
 * Ensures the LLM reads back the same vocabulary it writes.
 */
const FIGMA_TO_CSS: Record<string, Record<string, string>> = {
  layoutMode:              { VERTICAL: 'column', HORIZONTAL: 'row' },
  primaryAxisAlignItems:   { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' },
  counterAxisAlignItems:   { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' },
  layoutSizingHorizontal:  { FILL: 'fill', HUG: 'hug' },
  layoutSizingVertical:    { FILL: 'fill', HUG: 'hug' },
  textAlignHorizontal:     { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justified' },
  strokeAlign:             { INSIDE: 'inside', OUTSIDE: 'outside', CENTER: 'center' },
  layoutWrap:              { WRAP: 'wrap' },
};

/** Default values — skip these to reduce noise. */
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
  letterSpacing: 0,
  clipsContent: false,
  layoutWrap: 'NO_WRAP',
};

// ── XML escape ──

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Fill helpers ──

function formatFills(fills: any[]): { attr: string; value: string } | null {
  if (!fills || fills.length === 0) return null;

  // Normalize input: items can be strings, Figma Paint objects, or legacy gradient objects
  const normalized = fills.map((f: any) => {
    if (typeof f === 'string') {
      // Already a hex string → wrap as SOLID for spec
      return { type: 'SOLID', color: parseHexForSpec(f), opacity: 1 };
    }
    // Legacy format: { type: 'GRADIENT_LINEAR', stops: [...] } → convert stops to gradientStops
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

/** Parse a hex string into Figma-like RGB object (0-1 range) */
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

// ── Effect helpers ──

function formatEffects(effects: any[]): string | null {
  if (!effects || effects.length === 0) return null;

  // Normalize legacy format: blur → radius, string color → RGBA object
  const normalized = effects.map((e: any) => {
    const n = { ...e };
    // Legacy DSL uses "blur" where Figma uses "radius"
    if ('blur' in n && !('radius' in n)) {
      n.radius = n.blur;
    }
    // String color → RGBA object (effectSpec.fromFigma expects RGBA)
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

// ── Padding helpers ──

/**
 * Collapse individual padding values into compact shorthand.
 * Returns [attrName, value] or null if all zero.
 */
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

// ── Core serializer ──

export interface XmlSerializeOptions {
  maxDepth?: number;
  maxChildren?: number;
  /** Structural mode: only id, name, type, w, h, layout. Skips fills/fonts/effects/padding. */
  structural?: boolean;
}

/** Properties included in structural mode (skeleton only). */
const STRUCTURAL_PROPS = new Set([
  'name', 'width', 'height', 'layoutMode',
  'layoutSizingHorizontal', 'layoutSizingVertical',
  'x', 'y',
]);

/** Max inline text length in structural mode before collapsing to chars="N". */
const STRUCTURAL_TEXT_INLINE_MAX = 30;

export class XmlSerializer {
  /**
   * Serialize a NodeLayer tree to compact XML string.
   */
  static serialize(node: NodeLayer, options?: XmlSerializeOptions): string {
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
    structural: boolean = false,
  ): string {
    const tag = TAG_MAP[node.type] || 'frame';
    const props = (node.props || {}) as Record<string, any>;
    const indent = '  '.repeat(depth);

    // Build attributes
    const attrs: string[] = [];

    // id + name always first
    if (node.id) attrs.push(`id="${escapeXml(node.id)}"`);
    if (props.name) attrs.push(`name="${escapeXml(String(props.name))}"`);

    // ── Structural mode: skeleton attributes only ──
    if (structural) {
      for (const key of STRUCTURAL_PROPS) {
        if (key === 'name') continue; // already added
        const value = props[key];
        if (value === undefined || value === null) continue;
        if (key in DEFAULTS && value === DEFAULTS[key]) continue;
        const attrName = ATTR_ABBREV[key] || key;
        const cssMap = FIGMA_TO_CSS[key];
        const displayValue = cssMap ? (cssMap[String(value)] ?? String(value)) : String(value);
        attrs.push(`${attrName}="${escapeXml(displayValue)}"`);
      }

      // Text nodes: inline if short, otherwise chars="N"
      const characters = props.characters;
      const layerAny = node as any;
      if (layerAny._truncated) attrs.push('_truncated="true"');
      if (layerAny._childCount) attrs.push(`_childCount="${layerAny._childCount}"`);

      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

      const children = node.children;
      const hasChildren = children && children.length > 0 && depth < maxDepth;

      if (tag === 'text' && characters) {
        const charStr = String(characters);
        if (charStr.length <= STRUCTURAL_TEXT_INLINE_MAX) {
          return `${indent}<${tag}${attrStr}>${escapeXml(charStr)}</${tag}>`;
        } else {
          return `${indent}<${tag}${attrStr} chars="${charStr.length}"/>`;
        }
      }

      if (!hasChildren) {
        return `${indent}<${tag}${attrStr}/>`;
      }

      const lines: string[] = [`${indent}<${tag}${attrStr}>`];
      const visibleChildren = children!;
      const serialized = visibleChildren.slice(0, maxChildren);
      const truncatedCount = visibleChildren.length - serialized.length;

      for (const child of serialized) {
        lines.push(this.serializeNode(child, depth + 1, maxDepth, maxChildren, true));
      }

      if (truncatedCount > 0 || layerAny._moreChildren) {
        const moreCount = truncatedCount + (layerAny._moreChildren || 0);
        lines.push(`${indent}  <!-- +${moreCount} more -->`);
      }

      lines.push(`${indent}</${tag}>`);
      return lines.join('\n');
    }

    // ── Full mode: complete style attributes ──

    // Compact padding — consumes paddingTop/Right/Bottom/Left
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

    // Extract characters for body text (text nodes)
    const characters = props.characters;

    // Fills/strokes — handle specially
    const fillResult = formatFills(props.fills);
    const strokeResult = formatFills(props.strokes);

    // Effects — handle specially
    const effectStr = formatEffects(props.effects);

    // Iterate remaining INSPECT_PROPS
    for (const key of INSPECT_PROPS) {
      if (key === 'name' || key === 'characters') continue; // handled separately
      if (key === 'fills' || key === 'strokes' || key === 'effects') continue; // handled specially
      if (paddingConsumed.has(key)) continue;

      const value = props[key];
      if (value === undefined || value === null) continue;

      // Skip defaults
      if (key in DEFAULTS && value === DEFAULTS[key]) continue;

      // Special serialization: clipsContent → CSS overflow semantics
      if (key === 'clipsContent') {
        const attrName = ATTR_ABBREV[key] || key;
        attrs.push(`${attrName}="${value ? 'hidden' : 'visible'}"`);
        continue;
      }

      // Safety: skip objects that weren't handled upstream (prevents [object Object])
      if (typeof value === 'object') continue;

      const attrName = ATTR_ABBREV[key] || key;
      const cssMap = FIGMA_TO_CSS[key];
      const displayValue = cssMap ? (cssMap[String(value)] ?? String(value)) : String(value);
      attrs.push(`${attrName}="${escapeXml(displayValue)}"`);
    }

    // Add compact padding
    if (paddingResult) {
      attrs.push(`${paddingResult[0]}="${escapeXml(paddingResult[1])}"`);
    }

    // Add fill/stroke/effects
    if (fillResult) attrs.push(`${fillResult.attr}="${escapeXml(fillResult.value)}"`);
    if (strokeResult) attrs.push(`stroke="${escapeXml(strokeResult.value)}"`);
    if (effectStr) attrs.push(`shadow="${escapeXml(effectStr)}"`);

    // Truncation markers from NodeSerializer
    const layerAny = node as any;
    if (layerAny._truncated) attrs.push('_truncated="true"');
    if (layerAny._childCount) attrs.push(`_childCount="${layerAny._childCount}"`);

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    // Children
    const children = node.children;
    const hasChildren = children && children.length > 0 && depth < maxDepth;
    const isTextWithBody = tag === 'text' && characters;

    if (!hasChildren && !isTextWithBody) {
      return `${indent}<${tag}${attrStr}/>`;
    }

    const lines: string[] = [];

    if (isTextWithBody && !hasChildren) {
      // Text with body content: <text ...>Hello</text>
      lines.push(`${indent}<${tag}${attrStr}>${escapeXml(String(characters))}</${tag}>`);
    } else {
      lines.push(`${indent}<${tag}${attrStr}>`);

      // Text body before children (if any)
      if (isTextWithBody) {
        lines.push(`${indent}  ${escapeXml(String(characters))}`);
      }

      if (hasChildren) {
        const visibleChildren = children!;
        const serialized = visibleChildren.slice(0, maxChildren);
        const truncatedCount = visibleChildren.length - serialized.length;

        for (const child of serialized) {
          lines.push(this.serializeNode(child, depth + 1, maxDepth, maxChildren, false));
        }

        if (truncatedCount > 0 || layerAny._moreChildren) {
          const moreCount = truncatedCount + (layerAny._moreChildren || 0);
          lines.push(`${indent}  <!-- +${moreCount} more children -->`);
        }
      }

      lines.push(`${indent}</${tag}>`);
    }

    return lines.join('\n');
  }
}
