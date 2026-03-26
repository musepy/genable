/**
 * @file editHandler.ts
 * @description Handler for the `edit` tool — update properties on existing nodes.
 *
 * Supports single node: edit({node: "Card#1:2", props: {bg: "#FFF"}})
 * Supports batch:       edit({nodes: [{node: "A#1:1", props: {w: "fill"}}, {node: "B#1:2", props: {w: "fill"}}]})
 *
 * Constructs OperationIR[] directly — no string round-trip through flat ops.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import type { OperationIR } from '../../domain/design-ir';
import { executeIR } from './shared';
import { resolvePathToNode } from './pathResolver';
import { normalizeProps } from '../../domain/node-normalizers';
import { coerceValue } from '../../engine/utils/prop-dsl';
import { PipelineTracer } from './pipelineTracer';

interface EditEntry {
  node: string;
  props?: Record<string, any>;
  content?: string;
}

/** Build a single update OperationIR from a resolved nodeId + props/content. */
function buildUpdateIR(nodeId: string, props?: Record<string, any>, content?: string): OperationIR | null {
  const rawProps: Record<string, any> = {};
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      rawProps[key] = typeof value === 'string' ? coerceValue(key, value) : value;
    }
  }

  if (content !== undefined && content !== null) {
    rawProps.characters = String(content);
  }

  if (Object.keys(rawProps).length === 0) return null;

  return {
    command: 'update',
    targetRef: nodeId,
    props: normalizeProps(rawProps, {}, () => {}),
    dependsOn: [],
  };
}

export async function handleEdit(parameters: any): Promise<ToolResponse> {
  const tracer = new PipelineTracer();
  tracer.enter('handleEdit() → IR', 'editHandler.ts');

  // ── Batch mode: nodes array ──
  if (Array.isArray(parameters.nodes)) {
    const entries = parameters.nodes as EditEntry[];
    if (entries.length === 0) {
      return { error: { code: 'NO_CHANGES', message: 'Empty nodes array.' } };
    }

    const ops: OperationIR[] = [];
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

      const op = buildUpdateIR(resolved.node.id, entry.props, entry.content);
      if (!op) { errors.push(`No props or content for "${ref}"`); continue; }
      ops.push(op);
    }

    if (ops.length === 0) {
      return { error: { code: 'NO_CHANGES', message: errors.join('; ') } };
    }

    tracer.exit({ opsCount: ops.length });
    const result = await executeIR(ops, { tracer });
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

  const op = buildUpdateIR(resolved.node.id, props, content);
  if (!op) {
    return { error: { code: 'NO_CHANGES', message: 'No props or content provided.' } };
  }

  tracer.exit({ opsCount: 1 });
  return executeIR([op], { tracer });
}
