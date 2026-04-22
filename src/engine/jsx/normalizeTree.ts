/**
 * @file normalizeTree.ts
 * @description Pre-walk normalization phase for VNode trees.
 *
 * Runs after compile (VNode tree built) and before walkTree (Figma API calls).
 * Mutates each vnode.props so walkTree sees canonical Figma props.
 *
 * Per node (non-INSTANCE):
 *   1. TEXT: collect characters from string children (if not already set)
 *   2. ICON: map icon→iconName, size→width+height (NOT fontSize)
 *   3. IMAGE: extract placeholder→name, inject default fills
 *   4. applyMarginToGap — children's margins → parent's gap (tree-context)
 *   5. applyLayoutDefaults — FRAME/SECTION/COMPONENT/IMAGE with layout default to HUG
 *   6. normalizeProps — shorthand expansion, enum validation, type filter
 *
 * Order matters:
 *   - ICON's size→w/h MUST run before normalizeProps. If normalizeProps sees
 *     `size`, expandShorthands maps it to `fontSize` (which is then dropped
 *     as a text-only prop for non-text nodes — losing the sizing).
 *   - IMAGE's placeholder MUST be extracted before normalizeProps drops it
 *     via the unknown-property filter.
 *
 * Not handled (stays in walkTree):
 *   - INSTANCE (ref/variant/__set_* have special semantics)
 *   - normalizeSizingInProps (needs real Figma parent node)
 *   - Rich text markdown parsing (happens in applyTextProps, needs font loaded)
 */

import { normalizeProps } from '../../domain/node-normalizers';
import {
  type VNode,
  applyMarginToGap,
  applyLayoutDefaults,
  LOWERCASE_TYPE_MAP,
} from './templateCompiler';

export interface NormalizeWarning {
  code: string;
  message: string;
}

/** Node types that accept layout defaults (frames and frame-like containers). */
const LAYOUT_CONTAINER_TYPES = new Set<string>([
  'FRAME', 'SECTION', 'COMPONENT', 'IMAGE',
]);

/**
 * Normalize all VNodes in a tree in place.
 * Collects warnings from normalizeProps into the provided array.
 */
export function normalizeTree(
  vnodes: VNode[],
  warnings: NormalizeWarning[] = [],
): void {
  for (const v of vnodes) normalizeOne(v, warnings);
}

function normalizeOne(vnode: VNode, warnings: NormalizeWarning[]): void {
  const nodeType = LOWERCASE_TYPE_MAP[vnode.type] || vnode.type;

  // INSTANCE: skip entirely. walkTree handles __set_* overrides, ref, variant.
  // Normalizing would flag those special keys as unknown properties and drop them.
  if (nodeType === 'INSTANCE') return;

  const pushWarn = (msg: string) =>
    warnings.push({ code: 'NORMALIZE', message: msg });

  // ── Pre-normalize: type-specific handling that MUST run before normalizeProps ──
  preNormalize(vnode, nodeType);

  // Tree-context: margin→gap (mutates this node's gap + strips children's margin keys)
  applyMarginToGap(vnode, vnode.props);

  // Type-specific: HUG defaults for layout containers
  if (LAYOUT_CONTAINER_TYPES.has(nodeType)) {
    applyLayoutDefaults(nodeType, vnode.props);
  }

  // Per-node: shorthand expansion + enum validation + type filter
  vnode.props = normalizeProps(
    vnode.props,
    { nodeType, isCreate: true },
    pushWarn,
  );

  // Recurse into VNode children (strings already handled for TEXT)
  for (const child of vnode.children) {
    if (typeof child === 'object' && child !== null && 'type' in child) {
      normalizeOne(child, warnings);
    }
  }
}

/**
 * Type-specific preprocessing that must happen before normalizeProps runs.
 * Idempotent: safe to re-run (e.g. from walkTree's legacy per-node paths).
 */
function preNormalize(vnode: VNode, nodeType: string): void {
  const props = vnode.props;

  if (nodeType === 'TEXT') {
    // Collect characters from string children
    const stringChildren = vnode.children.filter(
      (c): c is string => typeof c === 'string',
    );
    if (stringChildren.length > 0 && props.characters === undefined) {
      props.characters = stringChildren.join('');
    }
    return;
  }

  if (nodeType === 'ICON') {
    // icon → iconName (fallback to name). Do NOT fall back when iconName exists.
    if (props.icon !== undefined && props.iconName === undefined) {
      props.iconName = props.icon;
    }
    if (props.iconName === undefined && typeof props.name === 'string') {
      props.iconName = props.name;
    }
    delete props.icon;

    // size → width+height. Must happen BEFORE expandShorthands sees `size`
    // (which would map it to `fontSize`, then get dropped as text-only).
    if (props.size !== undefined) {
      const s = typeof props.size === 'number'
        ? props.size
        : parseFloat(String(props.size));
      if (!isNaN(s)) {
        if (props.width === undefined) props.width = s;
        if (props.height === undefined) props.height = s;
      }
      delete props.size;
    }
    return;
  }

  if (nodeType === 'IMAGE') {
    // placeholder is a pseudo-prop used for naming; extract before it gets
    // filtered as unknown. Matches walkTree's IMAGE handler semantics.
    const placeholder =
      (typeof props.placeholder === 'string' && props.placeholder) ||
      (typeof props.name === 'string' && props.name) ||
      'Image Placeholder';
    if (props.fills === undefined) {
      props.fills = ['#E0E0E0'];
    }
    props.name = placeholder;
    delete props.placeholder;
    return;
  }
}
