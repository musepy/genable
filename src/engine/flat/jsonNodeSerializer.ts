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

// Full-mode properties are now emitted in semantic order inside addFullProps() —
// text: content → typography → fill → sizing → position
// frame: sizing → layout → visual → position

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
  GROUP: 'group',
  SECTION: 'section',
  ICON: 'icon',
  COMPONENT: 'component',
  COMPONENT_SET: 'componentSet',
  INSTANCE: 'instance',
  STAR: 'star',
  POLYGON: 'polygon',
  BOOLEAN_OPERATION: 'booleanOp',
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

// ── Role detection (algorithmic — no LLM) ──

const NAME_ROLE_PATTERNS: Array<{ pattern: RegExp; role: string }> = [
  { pattern: /btn|button/i, role: 'button' },
  { pattern: /^nav|navbar|navigation/i, role: 'nav' },
  { pattern: /header/i, role: 'header' },
  { pattern: /footer/i, role: 'footer' },
  { pattern: /sidebar/i, role: 'sidebar' },
  { pattern: /card/i, role: 'card' },
  { pattern: /avatar/i, role: 'avatar' },
  { pattern: /badge/i, role: 'badge' },
  { pattern: /tab/i, role: 'tab' },
  { pattern: /input|field|search.?bar/i, role: 'input' },
  { pattern: /label/i, role: 'label' },
  { pattern: /link/i, role: 'link' },
  { pattern: /icon/i, role: 'icon' },
  { pattern: /image|img|photo|thumbnail|hero/i, role: 'image' },
  { pattern: /divider|separator|rule/i, role: 'separator' },
  { pattern: /modal|dialog|overlay/i, role: 'dialog' },
  { pattern: /toast|snackbar|alert/i, role: 'alert' },
  { pattern: /chip|tag|pill/i, role: 'chip' },
  { pattern: /toggle|switch/i, role: 'toggle' },
  { pattern: /checkbox|check.?box/i, role: 'checkbox' },
  { pattern: /radio/i, role: 'radio' },
  { pattern: /dropdown|select|menu/i, role: 'menu' },
  { pattern: /tooltip/i, role: 'tooltip' },
  { pattern: /progress|loader|spinner/i, role: 'progress' },
  { pattern: /table/i, role: 'table' },
  { pattern: /row/i, role: 'row' },
  { pattern: /form/i, role: 'form' },
  { pattern: /list/i, role: 'list' },
];

function detectRole(
  name: string | undefined,
  tag: string,
  props: Record<string, any>,
  children?: NodeLayer[],
): string {
  // Tier 1: name-based
  if (name) {
    for (const { pattern, role } of NAME_ROLE_PATTERNS) {
      if (pattern.test(name)) return role;
    }
  }

  // Tier 2: type-based
  if (tag === 'text') {
    const size = props.fontSize;
    if (size >= 32) return 'heading(1)';
    if (size >= 24) return 'heading(2)';
    if (size >= 20) return 'heading(3)';
    return 'text';
  }

  if (tag === 'icon') return 'icon';

  // Tier 3: visual heuristics
  const w = props.width ?? 0;
  const h = props.height ?? 0;
  // Separator: very thin in one dimension
  if ((w > 0 && h > 0) && (w <= 2 || h <= 2)) return 'separator';

  // Button-like: has fill, small, has text child, no deep children
  const hasFill = props.fills && Array.isArray(props.fills) && props.fills.length > 0;
  const childCount = children?.length ?? 0;
  if (hasFill && childCount <= 2 && w > 0 && w <= 400 && h > 0 && h <= 64) {
    const hasTextChild = children?.some(c => (c.type === 'TEXT'));
    if (hasTextChild) return 'button';
  }

  return 'generic';
}

// ── Summary generation (algorithmic — no LLM) ──

// ── Progressive disclosure: root gets split fields, children get merged summary ──

/** Size: dimensions + sizing mode. JSX shorthand. */
function buildSize(tag: string, props: Record<string, any>): string | undefined {
  if (tag === 'text') return undefined; // text size is in visual
  const parts: string[] = [];
  const sizingH = props.layoutSizingHorizontal;
  const sizingV = props.layoutSizingVertical;
  if (sizingH === 'FILL') parts.push('w=fill');
  else if (sizingH === 'HUG') parts.push('w=hug');
  else if (props.width) parts.push(`w=${Math.round(props.width)}`);
  if (sizingV === 'FILL') parts.push('h=fill');
  else if (sizingV === 'HUG') parts.push('h=hug');
  else if (props.height) parts.push(`h=${Math.round(props.height)}`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** Visual: appearance properties. JSX shorthand. */
function buildVisual(tag: string, props: Record<string, any>): string | undefined {
  const parts: string[] = [];
  if (tag === 'text') {
    const chars = props.characters;
    if (chars) {
      const preview = String(chars).length > 30 ? String(chars).slice(0, 27) + '...' : String(chars);
      parts.push(`"${preview}"`);
    }
    if (props.fontSize) parts.push(`size=${props.fontSize}`);
    if (props.fontWeight && props.fontWeight !== 'normal' && props.fontWeight !== '400') parts.push(`weight=${props.fontWeight}`);
    const fill = extractFillColor(props);
    if (fill) parts.push(`fill=${fill}`);
  } else {
    const fill = extractFillColor(props);
    if (fill) parts.push(`bg=${fill}`);
    if (props.cornerRadius && props.cornerRadius > 0) parts.push(`corner=${props.cornerRadius}`);
    const strokes = props.strokes;
    if (strokes && Array.isArray(strokes) && strokes.length > 0) parts.push(`stroke=${strokes[0]}`);
    const effects = props.effects;
    if (effects && Array.isArray(effects) && effects.length > 0) parts.push(`shadow`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** Layout: structure properties. JSX shorthand. */
function buildLayout(props: Record<string, any>): string | undefined {
  if (!props.layoutMode || props.layoutMode === 'NONE') return undefined;
  const parts: string[] = [];
  parts.push(`layout=${props.layoutMode === 'HORIZONTAL' ? 'row' : 'column'}`);
  const gap = props.itemSpacing ?? props.gap;
  if (gap && gap > 0) parts.push(`gap=${gap}`);
  const alignMain = props.primaryAxisAlignItems;
  if (alignMain && alignMain !== 'MIN') {
    const map: Record<string, string> = { CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' };
    parts.push(`justify=${map[alignMain] || alignMain}`);
  }
  const alignCross = props.counterAxisAlignItems;
  if (alignCross && alignCross !== 'MIN') {
    const map: Record<string, string> = { CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' };
    parts.push(`align=${map[alignCross] || alignCross}`);
  }
  const pt = props.paddingTop ?? 0;
  const pr = props.paddingRight ?? 0;
  const pb = props.paddingBottom ?? 0;
  const pl = props.paddingLeft ?? 0;
  if (pt || pr || pb || pl) {
    if (pt === pr && pr === pb && pb === pl) parts.push(`p=${pt}`);
    else parts.push(`p=${pt},${pr},${pb},${pl}`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** Merged summary for child nodes — all info in one line. */
function buildSummary(tag: string, props: Record<string, any>): string | undefined {
  const parts: string[] = [];
  const size = buildSize(tag, props);
  const visual = buildVisual(tag, props);
  const layout = buildLayout(props);
  if (size) parts.push(size);
  if (visual) parts.push(visual);
  if (layout) parts.push(layout);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function extractFillColor(props: Record<string, any>): string | undefined {
  const fills = props.fills;
  if (!fills || !Array.isArray(fills) || fills.length === 0) return undefined;
  const first = fills[0];
  if (typeof first === 'string') return first;
  return undefined;
}

// ── Core ──

export interface JsonSerializeOptions {
  maxDepth?: number;
  maxChildren?: number;
  /** Structural mode: only name, layout, dimensions. */
  structural?: boolean;
  /** Skeleton mode: only id, name, children — pure hierarchy, no properties. */
  skeleton?: boolean;
}

export class JsonNodeSerializer {
  static serialize(node: NodeLayer, options?: JsonSerializeOptions): any {
    const maxDepth = options?.maxDepth ?? MAX_DEPTH;
    const maxChildren = options?.maxChildren ?? MAX_CHILDREN;
    const structural = options?.structural ?? false;
    const skeleton = options?.skeleton ?? false;
    if (skeleton) {
      return this.serializeSkeletonNode(node, 0, maxDepth, maxChildren);
    }
    return this.serializeNode(node, 0, maxDepth, maxChildren, structural);
  }

  /**
   * Skeleton mode: id, name, type, role, summary, children.
   * Role + summary are algorithmic (no LLM) — helps agent understand nodes without inspect detail.
   */
  private static serializeSkeletonNode(
    node: NodeLayer,
    depth: number,
    maxDepth: number,
    maxChildren: number,
  ): any {
    const tag = TAG_MAP[node.type] || 'frame';
    const props = (node.props || {}) as Record<string, any>;
    const name = props.name || undefined;
    const result: any = { id: node.id, name, type: tag };

    // Role detection (algorithmic — name patterns + type + visual heuristics)
    const role = detectRole(name, tag, props, node.children);
    if (role !== 'generic') result.role = role;

    // Progressive disclosure: root gets split fields, children get merged summary
    if (depth === 0) {
      // Root node: separate size + visual + layout for easier scanning
      const size = buildSize(tag, props);
      const visual = buildVisual(tag, props);
      const layout = buildLayout(props);
      if (size) result.size = size;
      if (visual) result.visual = visual;
      if (layout) result.layout = layout;
    } else {
      // Child nodes: merged summary (one line, saves tokens)
      const summary = buildSummary(tag, props);
      if (summary) result.summary = summary;
    }

    const children = node.children;
    if (children && children.length > 0 && depth < maxDepth) {
      const sliced = children.slice(0, maxChildren);
      result.children = sliced.map((child: NodeLayer) =>
        this.serializeSkeletonNode(child, depth + 1, maxDepth, maxChildren)
      );
      const truncated = children.length - sliced.length;
      if (truncated > 0) {
        result.children.push(`... +${truncated} more`);
      }
    }

    return result;
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


    // Name always first property
    if (props.name) result.name = props.name;

    // Text content right after name — most identifying property for text
    if (tag === 'text' && props.characters) {
      const charStr = String(props.characters);
      if (structural && charStr.length > 30) {
        result._contentLength = charStr.length;
      } else {
        result.content = charStr;
      }
    }

    // Add properties
    if (structural) {
      this.addStructuralProps(result, props);
    } else {
      this.addFullProps(result, props, tag);
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
    // Pre-compute compound values
    const hasPaddingProps = props.paddingTop !== undefined || props.paddingRight !== undefined ||
      props.paddingBottom !== undefined || props.paddingLeft !== undefined;
    const paddingValue = hasPaddingProps ? compactPaddingJson(props) : null;
    const fillsMixed = props.fills === MIXED;
    const strokesMixed = props.strokes === MIXED;
    const effectsMixed = props.effects === MIXED;
    const fillResult = fillsMixed ? null : formatFillsJson(props.fills);
    const strokeResult = strokesMixed ? null : formatFillsJson(props.strokes);
    const effectStr = effectsMixed ? null : formatEffectsJson(props.effects);

    // Helper: emit a single property with middle-name mapping, enum mapping, default filtering
    const emit = (key: string) => {
      const value = props[key];
      if (value === undefined || value === null) return;
      if (value === MIXED) { result[MIDDLE_NAMES[key] || key] = 'mixed'; return; }
      if (key in DEFAULTS && value === DEFAULTS[key]) return;
      // Suppress uniform per-side stroke weights
      if (key === 'strokeTopWeight' || key === 'strokeRightWeight' || key === 'strokeBottomWeight' || key === 'strokeLeftWeight') {
        const sw = props.strokeWeight;
        if (sw !== undefined && sw !== MIXED && value === sw) return;
      }
      if (key === 'clipsContent') { result.overflow = value ? 'hidden' : 'visible'; return; }
      if (key === 'dashPattern' && Array.isArray(value)) { if (value.length > 0) result.dashPattern = value; return; }
      if (key === 'constraints' && typeof value === 'object') {
        const ir = constraintsSpec.fromFigma(value);
        const defaultIr = constraintsSpec.defaultValue!;
        if (!constraintsSpec.isEqual(ir, defaultIr)) result.pin = constraintsSpec.formatXml(ir);
        return;
      }
      if (typeof value === 'object') return;
      const outKey = MIDDLE_NAMES[key] || key;
      const cssMap = ENUM_TO_CSS[key];
      result[outKey] = cssMap ? (cssMap[String(value)] ?? value) : value;
    };
    const emitFills = () => { if (fillsMixed) result.fill = 'mixed'; else if (fillResult) result[fillResult.key] = fillResult.value; };
    const emitStrokes = () => { if (strokesMixed) result.stroke = 'mixed'; else if (strokeResult) result.stroke = strokeResult.value; };
    const emitEffects = () => { if (effectsMixed) result.shadow = 'mixed'; else if (effectStr) result.shadow = effectStr; };
    const emitPadding = () => { if (paddingValue !== null) result.padding = paddingValue; };

    // ── Semantic ordering by node type ──
    if (tag === 'text') {
      // Text: typography → fill → sizing → position → other
      emit('fontSize'); emit('fontWeight'); emit('fontFamily');
      emit('textAlignHorizontal'); emit('lineHeight'); emit('letterSpacing');
      emitFills();
      emit('width'); emit('height');
      emit('layoutSizingHorizontal'); emit('layoutSizingVertical');
      emit('layoutPositioning'); emit('x'); emit('y');
      emit('opacity'); emit('visible');
      emit('minWidth'); emit('maxWidth'); emit('minHeight'); emit('maxHeight');
      emit('constrainProportions'); emit('constraints');
    } else {
      // Frame/container: sizing → layout → visual → position → other
      emit('width'); emit('height');
      emit('layoutSizingHorizontal'); emit('layoutSizingVertical');
      emit('layoutMode');
      emit('gap'); emit('counterAxisSpacing');
      emit('primaryAxisAlignItems'); emit('counterAxisAlignItems');
      emitPadding();
      emit('layoutWrap'); emit('clipsContent');
      emitFills();
      emit('cornerRadius'); emit('cornerSmoothing');
      emitStrokes();
      emit('strokeWeight'); emit('strokeAlign'); emit('strokeJoin'); emit('strokeCap');
      emit('strokeTopWeight'); emit('strokeRightWeight'); emit('strokeBottomWeight'); emit('strokeLeftWeight');
      emit('dashPattern'); emit('strokesIncludedInLayout');
      emitEffects();
      emit('layoutPositioning'); emit('x'); emit('y');
      emit('opacity'); emit('visible'); emit('blendMode'); emit('itemReverseZIndex');
      emit('minWidth'); emit('maxWidth'); emit('minHeight'); emit('maxHeight');
      emit('constrainProportions'); emit('constraints');
      emit('iconName');
    }
  }
}
