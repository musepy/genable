/**
 * @file xmlSerializer.ts
 * @description Converts NodeLayer trees to compact XML for LLM consumption.
 *
 * XML is 60-70% smaller than equivalent JSON for design trees.
 * Built-in property filtering + depth/children limits (aligned with ToolResultCleaner).
 */

import type { NodeLayer } from '../../schema/layerSchema';

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

function colorToHex(fill: any): string | null {
  if (typeof fill === 'string') return fill;
  if (fill && typeof fill === 'object' && fill.type === 'SOLID' && fill.color) {
    const { r, g, b } = fill.color;
    const hex = '#' + [r, g, b].map((c: number) =>
      Math.round(c * 255).toString(16).padStart(2, '0')
    ).join('');
    return hex.toUpperCase();
  }
  return null;
}

function isGradient(fill: any): boolean {
  return fill && typeof fill === 'object' && typeof fill.type === 'string' && fill.type.startsWith('GRADIENT');
}

function formatFills(fills: any[]): { attr: string; value: string } | null {
  if (!fills || fills.length === 0) return null;

  const hexColors: string[] = [];
  for (const f of fills) {
    if (isGradient(f)) {
      // Gradient: keep a compact representation
      const stops = (f.stops || []).map((s: any) => `${s.color}@${s.position}`).join(',');
      hexColors.push(`${f.type}(${stops})`);
    } else {
      const hex = colorToHex(f);
      if (hex) hexColors.push(hex);
    }
  }

  if (hexColors.length === 0) return null;
  if (hexColors.length === 1) return { attr: 'fill', value: hexColors[0] };
  return { attr: 'fills', value: hexColors.join(',') };
}

// ── Effect helpers ──

function formatEffects(effects: any[]): string | null {
  if (!effects || effects.length === 0) return null;

  const parts: string[] = [];
  for (const e of effects) {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      const ox = e.offset?.x ?? 0;
      const oy = e.offset?.y ?? 0;
      const blur = e.blur ?? e.radius ?? 0;
      const spread = e.spread ?? 0;
      const color = e.color || '#000';
      const prefix = e.type === 'INNER_SHADOW' ? 'inset,' : '';
      parts.push(`${prefix}${ox},${oy},${blur},${spread},${color}`);
    } else if (e.type === 'LAYER_BLUR') {
      parts.push(`blur(${e.blur ?? e.radius ?? 0})`);
    } else if (e.type === 'BACKGROUND_BLUR') {
      parts.push(`bgblur(${e.blur ?? e.radius ?? 0})`);
    }
  }
  return parts.length > 0 ? parts.join(';') : null;
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
        attrs.push(`${attrName}="${escapeXml(String(value))}"`);
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

      const attrName = ATTR_ABBREV[key] || key;
      attrs.push(`${attrName}="${escapeXml(String(value))}"`);
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
