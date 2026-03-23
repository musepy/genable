/**
 * @file jsxHandler.ts
 * @description Handler for the `jsx` command.
 *
 * Parses JSX-like nested markup → generates flat ops → executeFlatOps().
 * Reuses the entire existing pipeline (normalizer, executor, receipt builder).
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

// ── Build nested tree from JsxNode AST + executor symbol→id mapping ──

interface TreeNode {
  id: string;
  name: string;
  type: string;
  children?: TreeNode[];
}

/**
 * Rebuild the nested tree structure from the original JSX AST,
 * filling in real Figma IDs from the executor's symbol map.
 *
 * jsxToFlatOps assigns symbols n1, n2, n3... via DFS traversal.
 * We replay the same DFS order to match symbols to JsxNodes.
 */
function buildTreeFromJsx(
  roots: JsxNode[],
  symbolToId: Map<string, string>,
): TreeNode[] {
  let counter = 0;

  function visit(node: JsxNode): TreeNode | null {
    const sym = `n${++counter}`;
    const nodeId = symbolToId.get(sym);
    if (!nodeId) return null; // failed or skipped node

    const name = (node.attrs.name as string) || node.tag;
    const result: TreeNode = { id: nodeId, name, type: node.tag };

    if (node.children.length > 0) {
      const kids: TreeNode[] = [];
      for (const child of node.children) {
        const childTree = visit(child);
        if (childTree) kids.push(childTree);
      }
      if (kids.length > 0) result.children = kids;
    }

    return result;
  }

  const trees: TreeNode[] = [];
  for (const root of roots) {
    const tree = visit(root);
    if (tree) trees.push(tree);
  }
  return trees;
}

export async function handleJsx(parameters: any): Promise<ToolResponse> {
  const { markup, parentId } = parameters;

  if (!markup || typeof markup !== 'string') {
    return {
      success: true,
      data: {
        message: 'jsx — Create design trees with nested JSX-like syntax.',
        usage: 'run({command: "jsx", input: "<frame name=\'Card\' w={400} layout=\'column\' p={24}>\\n  <text name=\'Title\' size={24}>Card Title</text>\\n</frame>"})',
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
  const result = await executeFlatOps(flatOps, parentId);

  // Attach parse errors as stderr warnings
  if (errors.length > 0) {
    const parseWarnings = errors.map(e => `[warn] ${e}`).join('\n');
    result._stderr = result._stderr
      ? parseWarnings + '\n' + result._stderr
      : parseWarnings;
  }

  // ── Replace flat idMap with nested tree ──
  // idMap values are inserted in lineResults order = DFS order = jsxToFlatOps emit order.
  // Extract nodeIds by position, then rebuild the tree from the JSX AST.
  if (result.data?.idMap) {
    const idMap = result.data.idMap as Record<string, string>;
    // Extract nodeId from each "name#nodeId" value, in insertion order
    const nodeIds: string[] = [];
    for (const ref of Object.values(idMap)) {
      const hashIdx = ref.lastIndexOf('#');
      nodeIds.push(hashIdx >= 0 ? ref.slice(hashIdx + 1) : ref);
    }

    // DFS counter matches nodeIds by position (same DFS order as jsxToFlatOps)
    let idx = 0;
    const symbolToId = new Map<string, string>();
    function assignIds(node: JsxNode): void {
      const sym = `n${idx + 1}`;
      if (idx < nodeIds.length) {
        symbolToId.set(sym, nodeIds[idx]);
      }
      idx++;
      for (const child of node.children) assignIds(child);
    }
    for (const root of roots) assignIds(root);

    const tree = buildTreeFromJsx(roots, symbolToId);
    if (tree.length > 0) {
      delete result.data.idMap;
      result.data.tree = tree.length === 1 ? tree[0] : tree;
    }
  }

  // ── Post-creation quality scoring ──
  if (result.data?.tree) {
    try {
      // Extract root ID from tree
      const treeData = result.data.tree;
      const rootId = Array.isArray(treeData) ? treeData[0]?.id : treeData?.id;
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
