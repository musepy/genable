/**
 * @file jsxToIR.ts
 * @description Convert JsxNode[] AST directly to OperationIR[].
 *
 * Eliminates the string round-trip: JsxNode[] → flat ops string → OperationIR[].
 * DFS traversal produces typed OperationIR objects with all semantic transforms
 * (margin→gap, layout defaults, padding expansion) applied in-place.
 *
 * Property normalization pipeline (single pass):
 *   JsxNode.attrs → coerce types → semantic transforms → normalizeProps() → OperationIR.props
 */

import type { JsxNode } from './jsxParser';
import type { OperationIR } from '../../domain/design-ir';
import { TAG_TO_TYPE, coerceValue, computeDependsOn } from '../utils/prop-dsl';
import { normalizeProps } from '../../domain/node-normalizers';

export interface JsxToIRWarning {
  line: number;
  message: string;
}

export interface JsxToIRResult {
  ops: OperationIR[];
  warnings: JsxToIRWarning[];
}

/**
 * Convert JsxNode[] tree directly to OperationIR[] — no string intermediate.
 */
export function jsxToIR(roots: JsxNode[]): JsxToIRResult {
  const ops: OperationIR[] = [];
  const warnings: JsxToIRWarning[] = [];
  let counter = 0;

  function emit(node: JsxNode, parentSym: string): string {
    const sym = `n${++counter}`;
    const opNum = counter;
    const pushWarn = (msg: string) => warnings.push({ line: node.line, message: msg });

    // ── Extract reserved attrs ──
    const name = (node.attrs.name as string) || node.tag;
    const refComponent = node.attrs.ref as string || '';
    const variantSelector = node.attrs.variant as string || '';

    // ── Instance: <instance ref="Button" variant="Size=Large"/> ──
    if (node.tag === 'instance' || refComponent) {
      const compRef = refComponent || name;
      const props: Record<string, any> = {};
      const overrides: Record<string, Record<string, any>> = {};

      for (const [key, value] of Object.entries(node.attrs)) {
        if (key === 'name') { props.name = value; continue; }
        if (key === 'ref' || key === 'variant') continue;
        if (key.startsWith('set:')) {
          overrides[key.substring(4)] = { characters: value };
          continue;
        }
        props[key] = typeof value === 'string' ? coerceValue(key, value) : value;
      }
      if (!props.name) props.name = name;

      const deps = [...computeDependsOn(parentSym)];

      ops.push({
        command: 'instance',
        symbol: sym,
        parentRef: parentSym,
        props: normalizeProps(props, {}, pushWarn),
        dependsOn: deps,
        componentRef: compRef,
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        ...(variantSelector ? { variantSelector } : {}),
        lineNumber: opNum,
        raw: `<${node.tag} ref="${compRef}"/>`,
      });

      for (const child of node.children) emit(child, sym);
      return sym;
    }

    // ── Build raw props from attrs ──
    const rawProps: Record<string, any> = { name };
    for (const [key, value] of Object.entries(node.attrs)) {
      if (key === 'name' || key === 'ref' || key === 'variant') continue;

      // Expand object-valued padding into individual pt/pb/pl/pr
      if ((key === 'p' || key === 'padding') && typeof value === 'object' && value !== null) {
        const v = value as Record<string, number>;
        if (v.top != null || v.t != null) rawProps.pt = v.top ?? v.t;
        if (v.right != null || v.r != null) rawProps.pr = v.right ?? v.r;
        if (v.bottom != null || v.b != null) rawProps.pb = v.bottom ?? v.b;
        if (v.left != null || v.l != null) rawProps.pl = v.left ?? v.l;
        continue;
      }

      // Coerce string values; preserve already-typed values from JSX parser
      rawProps[key] = typeof value === 'string' ? coerceValue(key, value) : value;
    }

    // ── Text node ──
    if (node.tag === 'text') {
      if (node.textContent) rawProps.characters = node.textContent;

      ops.push({
        command: 'create',
        nodeType: 'TEXT',
        symbol: sym,
        parentRef: parentSym,
        props: normalizeProps(rawProps, { nodeType: 'TEXT', isCreate: true }, pushWarn),
        dependsOn: computeDependsOn(parentSym),
        lineNumber: opNum,
        raw: `<text name="${name}"/>`,
      });
      return sym;
    }

    // ── Icon node ──
    if (node.tag === 'icon') {
      // Icon identifier: textContent > icon attr > name attr
      const iconName = node.textContent || (rawProps.icon as string) || name;
      rawProps.iconName = iconName;
      delete rawProps.icon;

      // icon-specific: 'size' means width+height, not fontSize
      if (rawProps.size !== undefined) {
        const s = typeof rawProps.size === 'string' ? coerceValue('width', rawProps.size) : rawProps.size;
        rawProps.width = s;
        rawProps.height = s;
        delete rawProps.size;
      }

      ops.push({
        command: 'icon',
        symbol: sym,
        parentRef: parentSym,
        props: normalizeProps(rawProps, {}, pushWarn),
        dependsOn: computeDependsOn(parentSym),
        lineNumber: opNum,
        raw: `<icon name="${name}"/>`,
      });
      return sym;
    }

    // ── Container nodes (frame, rect, ellipse, component, image, etc.) ──
    const tag = node.tag;
    const figmaType = TAG_TO_TYPE[tag] || 'FRAME';
    const isReusable = tag === 'component';
    const isImage = tag === 'image';

    // ── Margin→Gap conversion (CSS mental model → Figma) ──
    // LLMs write mt/mb (CSS margin) on children, but Figma has no margins.
    // Convert children's mt/mb values into parent's gap if parent doesn't already have one.
    const hasGap = rawProps.gap !== undefined;
    if (!hasGap && node.children.length > 1) {
      const marginValues: number[] = [];
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const mt = child.attrs.mt ?? child.attrs.marginTop;
        const mb = child.attrs.mb ?? child.attrs.marginBottom;
        if (i > 0 && mt != null) marginValues.push(Number(mt));
        if (mb != null) marginValues.push(Number(mb));
      }
      if (marginValues.length > 0) {
        // Use mode (most common value) as gap
        const freq = new Map<number, number>();
        for (const v of marginValues) freq.set(v, (freq.get(v) || 0) + 1);
        rawProps.gap = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
      // Strip margin attrs from all children
      for (const child of node.children) {
        delete child.attrs.mt;
        delete child.attrs.mb;
        delete child.attrs.ml;
        delete child.attrs.mr;
        delete child.attrs.marginTop;
        delete child.attrs.marginBottom;
        delete child.attrs.marginLeft;
        delete child.attrs.marginRight;
      }
    }

    // ── Layout defaults injection ──
    // Frames with layout should default to hug if no explicit size
    const hasLayout = rawProps.layout !== undefined || rawProps.layoutMode !== undefined;
    if (hasLayout && (tag === 'frame' || tag === 'section' || tag === 'component')) {
      if (rawProps.h === undefined && rawProps.height === undefined && rawProps.sizingV === undefined) {
        rawProps.h = 'hug';
      }
      if (rawProps.w === undefined && rawProps.width === undefined && rawProps.sizingH === undefined) {
        rawProps.w = 'hug';
      }
    }

    const command = isImage ? 'image' : 'create';

    ops.push({
      command,
      nodeType: figmaType,
      symbol: sym,
      parentRef: parentSym,
      props: normalizeProps(rawProps, { nodeType: figmaType, isCreate: true }, pushWarn),
      dependsOn: computeDependsOn(parentSym),
      ...(isReusable ? { reusable: true } : {}),
      lineNumber: opNum,
      raw: `<${tag} name="${name}"/>`,
    });

    // Recurse children
    for (const child of node.children) emit(child, sym);

    return sym;
  }

  // Emit roots
  for (const root of roots) emit(root, 'root');

  return { ops, warnings };
}
