/**
 * @file editHandler.ts
 * @description Handler for the `edit` tool — update properties on existing nodes.
 *
 * Unlike mk (upsert), edit requires the node to exist.
 * Takes props as a JSON object, converts to mk-style propTokens internally.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { executeFlatOps, mkPropToFlatOps, escapeFlatOpsStr } from './shared';
import { resolvePathToNode } from './pathResolver';

export async function handleEdit(parameters: any): Promise<ToolResponse> {
  const { path, props, content } = parameters;

  if (!path) {
    return {
      success: true,
      data: {
        message: 'edit — Update properties on existing nodes.',
        usage: 'edit({path: "/Card/", props: {corner: 16, bg: "#FFF"}})',
      },
    };
  }

  // Resolve path — edit requires node to exist
  const resolved = await resolvePathToNode(path);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { success: false, error: { code: 'INVALID_TARGET', message: 'Cannot edit the page root. Specify a node path.' } };
  }

  const nodeId = resolved.node.id;

  // Build flat ops update line
  const propParts: string[] = [];
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      propParts.push(mkPropToFlatOps(`${key}:${value}`));
    }
  }

  const propsStr = propParts.join(', ');
  let flatOps: string;

  if (content !== undefined && content !== null) {
    // Text update: include characters
    const escaped = escapeFlatOpsStr(String(content));
    if (propsStr) {
      flatOps = `update('${nodeId}', {${propsStr}, characters:'${escaped}'})`;
    } else {
      flatOps = `update('${nodeId}', {characters:'${escaped}'})`;
    }
  } else if (propsStr) {
    flatOps = `update('${nodeId}', {${propsStr}})`;
  } else {
    return {
      success: false,
      error: {
        code: 'NO_CHANGES',
        message: 'No props or content provided. Specify at least one property to update.',
      },
    };
  }

  return executeFlatOps(flatOps);
}
