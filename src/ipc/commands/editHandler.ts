/**
 * @file editHandler.ts
 * @description Handler for the `edit` tool — update properties on existing nodes.
 *
 * Supports single node: edit({node: "Card#1:2", props: {bg: "#FFF"}})
 * Supports batch:       edit({nodes: [{node: "A#1:1", props: {w: "fill"}}, {node: "B#1:2", props: {w: "fill"}}]})
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { executeFlatOps, mkPropToFlatOps, escapeFlatOpsStr } from './shared';
import { resolvePathToNode } from './pathResolver';

interface EditEntry {
  node: string;
  props?: Record<string, any>;
  content?: string;
}

/** Build a single flat ops update line from a resolved nodeId + props/content. */
function buildUpdateOp(nodeId: string, props?: Record<string, any>, content?: string): string | null {
  const propParts: string[] = [];
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      propParts.push(mkPropToFlatOps(`${key}:${value}`));
    }
  }

  const propsStr = propParts.join(', ');

  if (content !== undefined && content !== null) {
    const escaped = escapeFlatOpsStr(String(content));
    if (propsStr) {
      return `update('${nodeId}', {${propsStr}, characters:'${escaped}'})`;
    }
    return `update('${nodeId}', {characters:'${escaped}'})`;
  }
  if (propsStr) {
    return `update('${nodeId}', {${propsStr}})`;
  }
  return null;
}

export async function handleEdit(parameters: any): Promise<ToolResponse> {
  // ── Batch mode: nodes array ──
  if (Array.isArray(parameters.nodes)) {
    const entries = parameters.nodes as EditEntry[];
    if (entries.length === 0) {
      return { error: { code: 'NO_CHANGES', message: 'Empty nodes array.' } };
    }

    const ops: string[] = [];
    const errors: string[] = [];

    for (const entry of entries) {
      const ref = entry.node;
      if (!ref) { errors.push('Missing node ref in batch entry'); continue; }

      const resolved = await resolvePathToNode(ref);
      if (!resolved.ok) {
        const errMsg = resolved.response.error?.message || `Cannot resolve "${ref}"`;
        errors.push(errMsg);
        continue;
      }
      if (resolved.isPage) { errors.push(`Cannot edit page root (ref: "${ref}")`); continue; }

      const op = buildUpdateOp(resolved.node.id, entry.props, entry.content);
      if (!op) { errors.push(`No props or content for "${ref}"`); continue; }
      ops.push(op);
    }

    if (ops.length === 0) {
      return { error: { code: 'NO_CHANGES', message: errors.join('; ') } };
    }

    const result = await executeFlatOps(ops.join('\n'));
    if (errors.length > 0) {
      result._stderr = result._stderr
        ? result._stderr + '\n' + errors.map(e => `[warn] ${e}`).join('\n')
        : errors.map(e => `[warn] ${e}`).join('\n');
    }
    return result;
  }

  // ── Single mode: node + props/content ──
  const ref = parameters.node || parameters.path;
  const { props, content } = parameters;

  if (!ref) {
    return {
      data: {
        message: 'edit — Update properties on existing nodes.',
        usage: 'edit({node: "Card#1:2", props: {corner: 16, bg: "#FFF"}})',
        batch: 'edit({nodes: [{node: "A#1:1", props: {w: "fill"}}, {node: "B#1:2", props: {w: "fill"}}]})',
      },
    };
  }

  const resolved = await resolvePathToNode(ref);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: { code: 'INVALID_TARGET', message: 'Cannot edit the page root. Specify a node ref.' } };
  }

  const op = buildUpdateOp(resolved.node.id, props, content);
  if (!op) {
    return { error: { code: 'NO_CHANGES', message: 'No props or content provided.' } };
  }

  return executeFlatOps(op);
}
