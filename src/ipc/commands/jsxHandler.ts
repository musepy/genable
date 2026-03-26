/**
 * @file jsxHandler.ts
 * @description Handler for the `jsx` command.
 *
 * Parses JSX markup → converts to typed IR → executes directly.
 * No intermediate compilation step — OperationIR goes straight to executor.
 * Uses abort + rollback: all nodes created or none (atomic).
 *
 * Syntax:
 *   <frame name="Card" w={400} layout="column" p={24}>
 *     <text name="Title" size={24}>Card Title</text>
 *   </frame>
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { parseJsx, type JsxNode } from '../../engine/jsx/jsxParser';
import { jsxToIR } from '../../engine/jsx/jsxToIR';
import { executeIR } from './shared';
import { scoreCreatedNodes, formatQualityReport } from './qualityScorer';
import { PipelineTracer } from './pipelineTracer';

export async function handleJsx(parameters: any): Promise<ToolResponse> {
  const { markup, parentId } = parameters;

  if (!markup || typeof markup !== 'string') {
    return {
      data: {
        message: 'jsx — Create design trees with nested JSX-like syntax.',
        usage: 'jsx({markup: "<frame name=\'Card\' w={400} layout=\'column\' p={24}>\\n  <text name=\'Title\' size={24}>Card Title</text>\\n</frame>"})',
        elements: ['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'instance', 'component', 'group', 'section', 'vector'],
        attributes: 'Same shorthands as mk: w, h, bg, layout, gap, p, corner, fill, size, weight, etc.',
      },
    };
  }

  const tracer = new PipelineTracer();

  // Step 1: Parse JSX markup → AST
  tracer.enter('parseJsx()', 'jsxParser.ts');
  const { roots, errors } = parseJsx(markup);
  tracer.exit({ roots: roots.length, errors: errors.length });

  if (roots.length === 0) {
    return {
      error: {
        code: 'PARSE_ERROR',
        message: errors.length > 0
          ? `Parse errors: ${errors.join('; ')}`
          : 'No valid elements found in JSX markup.',
      },
      _stages: tracer.collect(),
    };
  }

  // Step 2: Convert AST → typed IR (no string round-trip)
  tracer.enter('jsxToIR()', 'jsxToIR.ts');
  const { ops: irOps, warnings: irWarnings } = jsxToIR(roots);
  tracer.exit({ opsCount: irOps.length });

  // Step 3: Execute — OperationIR[] goes directly to executor
  tracer.enter('executeIR()', 'shared.ts');
  const result = await executeIR(irOps, {
    parentId,
    onError: 'abort',
    rollbackMode: 'created_nodes',
    irWarnings,
    tracer,
  });
  // tracer stages continue inside executeIR (executor + receipt)

  // Attach parse errors as stderr warnings
  if (errors.length > 0) {
    const parseWarnings = errors.map(e => `[warn] ${e}`).join('\n');
    result._stderr = result._stderr
      ? parseWarnings + '\n' + result._stderr
      : parseWarnings;
  }

  // ── Replace flat idMap with {id, name, type, children: [name#id]} ──
  if (!result.error && result.data?.idMap) {
    const idMap = result.data.idMap as Record<string, string>;

    const symbolToRef = new Map<string, string>();
    const refs = Object.values(idMap);
    let counter = 0;
    function walkForSymbols(node: JsxNode): void {
      const sym = `n${++counter}`;
      if (counter - 1 < refs.length) symbolToRef.set(sym, refs[counter - 1]);
      for (const child of node.children) walkForSymbols(child);
    }
    for (const root of roots) walkForSymbols(root);

    counter = 0;
    function buildRootResult(node: JsxNode): any {
      const sym = `n${++counter}`;
      const ref = symbolToRef.get(sym);
      if (!ref) return null;

      const hashIdx = ref.lastIndexOf('#');
      const id = hashIdx >= 0 ? ref.slice(hashIdx + 1) : ref;
      const name = (node.attrs.name as string) || node.tag;

      const result: any = { id, name, type: node.tag };

      const childRefs: string[] = [];
      for (const child of node.children) {
        const childSym = `n${counter + 1}`;
        const childRef = symbolToRef.get(childSym);
        if (childRef) childRefs.push(childRef);
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
      const rootData = rootResults.length === 1 ? rootResults[0] : rootResults[0];
      if (rootData) {
        Object.assign(result.data, rootData);
        if (rootResults.length > 1) {
          result.data.roots = rootResults;
        }
      }
    }
  }

  // ── Post-creation quality scoring ──
  if (!result.error && result.data?.id) {
    try {
      tracer.enter('scoreNodes()', 'qualityScorer.ts');
      const rootId = result.data.id;
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
    tracer.exit();
  }

  // Attach final pipeline stages
  result._stages = tracer.collect();
  return result;
}
