/**
 * @file jsxToFlatOps.ts
 * @description Convert JsxNode[] AST to flat ops string.
 *
 * Depth-first traversal, same pattern as renderHandler.ts:generateFlatOps().
 * Reuses mkPropToFlatOps, injectLayoutDefaults, escapeFlatOpsStr from shared.ts.
 *
 * Output format:
 *   n1 = frame(root, {name:'Card', w:400, layout:'column', p:'24'})
 *   n2 = text(n1, {name:'Title', size:24, weight:'Bold', fill:'#111'}, 'Card Title')
 */

import type { JsxNode } from './jsxParser';
import { escapeFlatOpsStr, injectLayoutDefaults, mkPropToFlatOps } from '../../ipc/commands/shared';

/**
 * Convert JsxNode[] tree into flat ops string for executeFlatOps().
 */
export function jsxToFlatOps(roots: JsxNode[]): string {
  const lines: string[] = [];
  let counter = 0;

  function emit(node: JsxNode, parentSym: string): string {
    const sym = `n${++counter}`;

    // Build prop tokens from attrs (excluding 'name' and 'ref')
    const propTokens: string[] = [];
    let name = '';
    let refComponent = '';
    let variantSelector = '';

    for (const [key, value] of Object.entries(node.attrs)) {
      if (key === 'name') {
        name = String(value);
        continue;
      }
      if (key === 'ref') {
        refComponent = String(value);
        continue;
      }
      if (key === 'variant') {
        variantSelector = String(value);
        continue;
      }
      // Expand object-valued padding into individual pt/pb/pl/pr tokens
      if ((key === 'p' || key === 'padding') && typeof value === 'object' && value !== null) {
        const v = value as Record<string, number>;
        if (v.top != null || v.t != null) propTokens.push(`pt:${v.top ?? v.t}`);
        if (v.right != null || v.r != null) propTokens.push(`pr:${v.right ?? v.r}`);
        if (v.bottom != null || v.b != null) propTokens.push(`pb:${v.bottom ?? v.b}`);
        if (v.left != null || v.l != null) propTokens.push(`pl:${v.left ?? v.l}`);
        continue;
      }
      propTokens.push(`${key}:${value}`);
    }

    // Default name from tag if not specified
    if (!name) name = node.tag;

    // Instance: <instance ref="Button" variant="Size=Large"/>
    if (node.tag === 'instance' || refComponent) {
      const refName = refComponent || name;
      const propsInner = buildPropsInner(propTokens, name, variantSelector);
      lines.push(`${sym} = ref('${escapeFlatOpsStr(refName)}', ${parentSym}, {${propsInner}})`);
      // Instances can have children too
      for (const child of node.children) {
        emit(child, sym);
      }
      return sym;
    }

    // Text node
    if (node.tag === 'text') {
      const content = node.textContent || '';
      const propsInner = buildPropsInner(propTokens, name);
      lines.push(
        `${sym} = text(${parentSym}, {${propsInner}}, '${escapeFlatOpsStr(content)}')`,
      );
      return sym;
    }

    // Icon node
    if (node.tag === 'icon') {
      const content = node.textContent || node.attrs['name'] as string || '';
      const propsInner = buildPropsInner(propTokens, name);
      lines.push(
        `${sym} = icon(${parentSym}, {${propsInner}}, '${escapeFlatOpsStr(String(content))}')`,
      );
      return sym;
    }

    // Container nodes (frame, rect, ellipse, etc.)
    const effectiveType = node.tag === 'component' ? 'component' : node.tag;

    // Inject layout defaults for frames with layout
    const injected = injectLayoutDefaults(effectiveType, propTokens);

    const propsInner = buildPropsInner(injected, name);
    lines.push(
      `${sym} = ${effectiveType}(${parentSym}, {${propsInner}})`,
    );

    // Recurse into children
    for (const child of node.children) {
      emit(child, sym);
    }

    return sym;
  }

  // Emit roots
  if (roots.length > 1) {
    // Multiple roots → each gets 'root' as parent (no auto-wrap, unlike render)
    for (const root of roots) {
      emit(root, 'root');
    }
  } else if (roots.length === 1) {
    emit(roots[0], 'root');
  }

  return lines.join('\n');
}

/**
 * Build the inner part of a flat ops props block: "name:'Card', w:400, ..."
 */
function buildPropsInner(
  propTokens: string[],
  name: string,
  variantSelector?: string,
): string {
  const parts: string[] = [];

  // Name first
  parts.push(`name:'${escapeFlatOpsStr(name)}'`);

  // Variant selector
  if (variantSelector) {
    parts.push(`variant:'${escapeFlatOpsStr(variantSelector)}'`);
  }

  // Convert prop tokens to flat ops format
  for (const token of propTokens) {
    parts.push(mkPropToFlatOps(token));
  }

  return parts.join(', ');
}
