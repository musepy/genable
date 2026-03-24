/**
 * @file jsxHandler.ts
 * @description Handler for the `jsx` command.
 *
 * Parses JSX-like nested markup → generates flat ops → executeFlatOps().
 * Uses abort + rollback: all nodes created or none (atomic).
 * Returns root node + one-level childIds (like Open-Pencil's render).
 *
 * Syntax:
 *   <frame name="Card" w={400} layout="column" p={24}>
 *     <text name="Title" size={24}>Card Title</text>
 *   </frame>
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { parseJsx, type JsxNode } from '../../engine/jsx/jsxParser';
import { jsxToFlatOps } from '../../engine/jsx/jsxToFlatOps';
import { executeFlatOps } from './shared';
import { scoreCreatedNodes, formatQualityReport } from './qualityScorer';

export async function handleJsx(parameters: any): Promise<ToolResponse> {
  const { markup, parentId } = parameters;

  if (!markup || typeof markup !== 'string') {
    return {
      success: true,
      data: {
        message: 'jsx — Create design trees with nested JSX-like syntax.',
        usage: 'jsx({markup: "<frame name=\'Card\' w={400} layout=\'column\' p={24}>\\n  <text name=\'Title\' size={24}>Card Title</text>\\n</frame>"})',
        elements: ['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'instance', 'component', 'group', 'section', 'vector'],
        attributes: 'Same shorthands as mk: w, h, bg, layout, gap, p, corner, fill, size, weight, etc.',
      },
    };
  }

  const { roots, errors } = parseJsx(markup);

  if (roots.length === 0) {
    return {
      success: false,
      error: {
        code: 'PARSE_ERROR',
        message: errors.length > 0
          ? `Parse errors: ${errors.join('; ')}`
          : 'No valid elements found in JSX markup.',
      },
    };
  }

  const flatOps = jsxToFlatOps(roots);
  const result = await executeFlatOps(flatOps, {
    parentId,
    onError: 'abort',
    rollbackMode: 'created_nodes',
  });

  // Attach parse errors as stderr warnings
  if (errors.length > 0) {
    const parseWarnings = errors.map(e => `[warn] ${e}`).join('\n');
    result._stderr = result._stderr
      ? parseWarnings + '\n' + result._stderr
      : parseWarnings;
  }

  // ── Replace flat idMap with {id, name, type, children: [name#id]} ──
  // Return root + one-level direct children refs (like Open-Pencil's render).
  // Agent already knows the full tree (it wrote the JSX) — only needs IDs.
  if (result.success && result.data?.idMap) {
    const idMap = result.data.idMap as Record<string, string>;

    // Build symbol → ref map (DFS order matches jsxToFlatOps)
    const symbolToRef = new Map<string, string>();
    const refs = Object.values(idMap);
    let counter = 0;
    function walkForSymbols(node: JsxNode): void {
      const sym = `n${++counter}`;
      if (counter - 1 < refs.length) symbolToRef.set(sym, refs[counter - 1]);
      for (const child of node.children) walkForSymbols(child);
    }
    for (const root of roots) walkForSymbols(root);

    // Build root + one-level children for each root
    counter = 0;
    function buildRootResult(node: JsxNode): any {
      const sym = `n${++counter}`;
      const ref = symbolToRef.get(sym);
      if (!ref) return null;

      const hashIdx = ref.lastIndexOf('#');
      const id = hashIdx >= 0 ? ref.slice(hashIdx + 1) : ref;
      const name = (node.attrs.name as string) || node.tag;

      const result: any = { id, name, type: node.tag };

      // One-level children: only direct children refs, not recursive
      const childRefs: string[] = [];
      for (const child of node.children) {
        const childSym = `n${counter + 1}`;
        const childRef = symbolToRef.get(childSym);
        if (childRef) childRefs.push(childRef);
        // Still advance counter through all descendants
        function skip(n: JsxNode): void { counter++; for (const c of n.children) skip(c); }
        skip(child);
      }
      if (childRefs.length > 0) result.children = childRefs;

      return result;
    }

    const rootResults: any[] = [];
    for (const root of roots) {
      const r = buildRootResult(root);
      if (r) rootResults.push(r);
    }

    if (rootResults.length > 0) {
      delete result.data.idMap;
      result.data.node = rootResults.length === 1 ? rootResults[0] : rootResults;
    }
  }

  // ── Post-creation quality scoring ──
  if (result.success && result.data?.node) {
    try {
      const nodeData = result.data.node;
      const rootId = Array.isArray(nodeData) ? nodeData[0]?.id : nodeData?.id;
      if (rootId) {
        const report = await scoreCreatedNodes([rootId]);
        const qualityStr = formatQualityReport(report);
        if (qualityStr) {
          result._stderr = result._stderr
            ? result._stderr + '\n' + qualityStr
            : qualityStr;
        }
      }
    } catch { /* quality scoring is best-effort, don't fail the tool */ }
  }

  return result;
}
