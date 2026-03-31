/**
 * @file structureAdapter.ts
 * @description Thin adapter for the `structure` tool — routes structured params
 * to existing handleRm/handleMv/handleCp handlers.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleRm, handleMv, handleCp } from './writeHandlers';

export async function handleStructure(params: any): Promise<ToolResponse> {
  const { action, node } = params;

  if (!action) {
    return { error: { code: 'MISSING_ARG', message: 'structure requires an "action" (move, delete, or clone).' } };
  }
  if (!node) {
    return { error: { code: 'MISSING_ARG', message: 'structure requires a "node" ref.' } };
  }

  switch (action) {
    case 'delete':
      return handleRm({ path: node });

    case 'move': {
      // Build dest path: if only `name` is given, resolve as rename-in-place
      let destPath = params.dest;
      if (!destPath && params.name) {
        // Rename: keep same parent, change name
        // For name#id refs, we need the dispatcher to resolve the parent.
        // Use the node ref as source and construct a simple dest with new name.
        destPath = params.name;
      }
      if (!destPath && params.index == null) {
        return { error: { code: 'MISSING_DEST', message: 'move requires "dest", "name", or "index".' } };
      }
      return handleMv({
        sourcePath: node,
        destPath: destPath || node,
        at: params.index,
      });
    }

    case 'clone': {
      if (!params.dest) {
        return { error: { code: 'MISSING_DEST', message: 'clone requires a "dest" path.' } };
      }
      return handleCp({
        sourcePath: node,
        destPath: params.dest,
        propsRaw: params.overrides,
      });
    }

    default:
      return { error: { code: 'UNKNOWN_ACTION', message: `Unknown action "${action}". Use: move, delete, clone.` } };
  }
}
