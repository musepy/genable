/**
 * @file nodesToFlatOps.ts
 * @description Convert structured JSON node array to flat ops string.
 *
 * Input: Array of node objects with parent references (by name).
 * Output: Flat ops string for executeFlatOps().
 *
 * This is the "structured" alternative to JSX string parsing —
 * the node array comes from the LLM's JSON tool call, fully validated
 * by the tool call framework. No custom string parsing needed.
 */

import { escapeFlatOpsStr, injectLayoutDefaults, mkPropToFlatOps } from '../../ipc/commands/shared';

// ── Types ──

export interface CreateNode {
  tag: string;         // frame, text, rect, ellipse, etc.
  name: string;        // display name + parent reference target
  parent?: string;     // parent node's name (omit for root)
  content?: string;    // text content (for text/icon nodes)
  ref?: string;        // component reference (for instances)
  variant?: string;    // variant selector
  [key: string]: any;  // all other props (w, h, layout, gap, p, bg, etc.)
}

// Reserved keys — not passed as design props
const RESERVED_KEYS = new Set(['tag', 'name', 'parent', 'content', 'ref', 'variant']);

/**
 * Convert CreateNode[] to flat ops string.
 *
 * Resolution: nodes are processed in order. `parent` field references
 * the most recent node with that name. Unresolved parents → root.
 */
export function nodesToFlatOps(nodes: CreateNode[]): string {
  const lines: string[] = [];
  let counter = 0;

  // name → symbol mapping (last-write-wins for duplicate names)
  const nameToSym = new Map<string, string>();

  for (const node of nodes) {
    const sym = `n${++counter}`;
    const tag = node.tag || 'frame';
    const name = node.name || tag;

    // Resolve parent
    let parentSym = 'root';
    if (node.parent) {
      const resolved = nameToSym.get(node.parent);
      if (resolved) {
        parentSym = resolved;
      }
      // else: unresolved parent → root (with warning, but no fatal)
    }

    // Register this node for future parent lookups
    nameToSym.set(name, sym);

    // Extract design props (everything not reserved)
    const propTokens: string[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (RESERVED_KEYS.has(key)) continue;
      if (value === undefined || value === null) continue;
      propTokens.push(`${key}:${value}`);
    }

    // Instance: ref field present
    if (node.ref) {
      const propsInner = buildPropsInner(propTokens, name, node.variant);
      lines.push(`${sym} = ref('${escapeFlatOpsStr(node.ref)}', ${parentSym}, {${propsInner}})`);
      continue;
    }

    // Text node
    if (tag === 'text') {
      const content = node.content || '';
      const propsInner = buildPropsInner(propTokens, name);
      lines.push(`${sym} = text(${parentSym}, {${propsInner}}, '${escapeFlatOpsStr(content)}')`);
      continue;
    }

    // Icon node
    if (tag === 'icon') {
      const content = node.content || '';
      const propsInner = buildPropsInner(propTokens, name);
      lines.push(`${sym} = icon(${parentSym}, {${propsInner}}, '${escapeFlatOpsStr(content)}')`);
      continue;
    }

    // Container nodes — inject layout defaults
    const injected = injectLayoutDefaults(tag, propTokens);
    const propsInner = buildPropsInner(injected, name);
    lines.push(`${sym} = ${tag}(${parentSym}, {${propsInner}})`);
  }

  return lines.join('\n');
}

function buildPropsInner(
  propTokens: string[],
  name: string,
  variantSelector?: string,
): string {
  const parts: string[] = [];
  parts.push(`name:'${escapeFlatOpsStr(name)}'`);
  if (variantSelector) {
    parts.push(`variant:'${escapeFlatOpsStr(variantSelector)}'`);
  }
  for (const token of propTokens) {
    parts.push(mkPropToFlatOps(token));
  }
  return parts.join(', ');
}
