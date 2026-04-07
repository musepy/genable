/**
 * @file structureAdapter.ts
 * @description Adapters for structure tools — maps structured params to writeHandlers.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleRm, handleMv, handleCp } from './writeHandlers';
import { resolvePathToNode } from './pathResolver';

export async function handleDeleteNode(params: any): Promise<ToolResponse> {
  return handleRm({ path: params.node });
}

export async function handleMoveNode(params: any): Promise<ToolResponse> {
  let destPath = params.dest;
  if (!destPath && params.name) {
    destPath = params.name;
  }
  if (!destPath && params.index == null) {
    return { error: 'move_node requires "dest", "name", or "index".' };
  }
  return handleMv({
    sourcePath: params.node,
    destPath: destPath || params.node,
    at: params.index,
  });
}

export async function handleCloneNode(params: any): Promise<ToolResponse> {
  // Serialize overrides object to the string format handleCp expects
  let propsRaw: string | undefined;
  if (params.overrides && typeof params.overrides === 'object') {
    propsRaw = '{' + Object.entries(params.overrides)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ') + '}';
  } else if (typeof params.overrides === 'string') {
    propsRaw = params.overrides;
  }

  // Resolve source node
  const sourceResolved = await resolvePathToNode(params.node);
  if (!sourceResolved.ok) return sourceResolved.response;
  if (sourceResolved.isPage) return { error: 'Cannot clone page root.' };

  const cloneName = params.name || sourceResolved.node.name;

  // Resolve parent (dest)
  let parentId: string | undefined;
  const dest: string = params.dest ?? '/';
  if (dest && dest !== '/' && dest !== '') {
    const destResolved = await resolvePathToNode(dest);
    if (!destResolved.ok) return destResolved.response;
    if (!destResolved.isPage) parentId = destResolved.node.id;
    // else: dest resolved to page root → parentId remains undefined
  }
  // parentId undefined = page root

  return handleCp({
    sourceId: sourceResolved.node.id,
    parentId,
    cloneName,
    propsRaw,
  });
}
