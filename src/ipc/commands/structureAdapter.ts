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

  // Resolve destPath for handleCp.
  // handleCp uses splitPath(destPath) expecting "/ParentRef/CloneName" format.
  // We resolve the dest parent ref here so we can supply a proper path.
  const dest: string = params.dest ?? '/';
  const isPageRoot = dest === '/' || dest === '';

  let destPath: string;

  if (isPageRoot) {
    // Clone to page root — determine clone name and use "/<cloneName>"
    const cloneName = await resolveCloneName(params.node, params.name);
    if (!cloneName) {
      return { error: `Cannot resolve source node "${params.node}" to determine clone name.` };
    }
    destPath = `/${cloneName}`;
  } else if (dest.includes('/')) {
    // Legacy path format like "/SomeParent/CloneName" — pass through as-is
    destPath = dest;
  } else {
    // Node ref (bare id "1:4" or "Name#1:4") — build "/<parentRef>/<cloneName>"
    // Encode as "name#id" so the legacy path segment resolver handles it correctly.
    const parentResolved = await resolvePathToNode(dest);
    if (!parentResolved.ok) return parentResolved.response;
    if (parentResolved.isPage) {
      // dest resolved to page root
      const cloneName = await resolveCloneName(params.node, params.name);
      if (!cloneName) {
        return { error: `Cannot resolve source node "${params.node}" to determine clone name.` };
      }
      destPath = `/${cloneName}`;
    } else {
      const parentNode = parentResolved.node;
      const cloneName = params.name ?? (await resolveCloneName(params.node, undefined));
      if (!cloneName) {
        return { error: `Cannot resolve source node "${params.node}" to determine clone name.` };
      }
      // Use "name#id" segment so the legacy path resolver finds it by ID
      destPath = `/${parentNode.name}#${parentNode.id}/${cloneName}`;
    }
  }

  return handleCp({
    sourcePath: params.node,
    destPath,
    propsRaw,
  });
}

/** Resolve the name to use for the clone. Falls back to source node's name. */
async function resolveCloneName(sourceRef: string, explicitName?: string): Promise<string | null> {
  if (explicitName) return explicitName;
  const resolved = await resolvePathToNode(sourceRef);
  if (!resolved.ok || resolved.isPage) return null;
  return resolved.node.name;
}
