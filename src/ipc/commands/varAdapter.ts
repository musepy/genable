/**
 * @file varAdapter.ts
 * @description Thin adapter for the `var` tool — maps structured params to handleVar.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleVar } from './varHandlers';

export async function handleVarTool(params: any): Promise<ToolResponse> {
  // Map action → subcommand (handleVar expects "ls", "mk", "mk-collection", "bind", "alias")
  let subcommand = params.action;
  if (subcommand === 'create') {
    // Creating a collection (collection set, no variable) → mk-collection
    subcommand = (params.collection && !params.variable) ? 'mk-collection' : 'mk';
  }

  return handleVar({
    subcommand,
    collection: params.collection,
    variable: params.variable,
    varType: params.type,
    value: params.value,
    modes: params.modes,
    mode: params.mode,
    nodePath: params.node,
    property: params.prop,
    target: params.target,
  });
}
