/**
 * @file varAdapter.ts
 * @description Adapters for variable tools — maps structured params to varHandlers.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleVarLs, handleVarMk, handleVarMkCollection, handleVarBind, handleVarSetMode, handleVarAlias } from './varHandlers';

export async function handleListVariables(params: any): Promise<ToolResponse> {
  return handleVarLs({ collection: params.collection });
}

export async function handleCreateVariable(params: any): Promise<ToolResponse> {
  // Collection creation: collection set without variable
  if (params.collection && !params.variable) {
    return handleVarMkCollection({
      collection: params.collection,
      modes: Array.isArray(params.modes) ? params.modes.join(',') : params.modes,
    });
  }
  return handleVarMk({
    variable: params.variable,
    varType: params.type,
    value: params.value,
    mode: params.mode,
  });
}

export async function handleBindVariable(params: any): Promise<ToolResponse> {
  return handleVarBind({
    nodePath: params.node,
    property: params.prop,
    variable: params.variable,
  });
}

export async function handleSetVariableMode(params: any): Promise<ToolResponse> {
  return handleVarSetMode({
    nodePath: params.node,
    collection: params.collection,
    mode: params.mode,
  });
}

export async function handleAliasVariable(params: any): Promise<ToolResponse> {
  return handleVarAlias({
    variable: params.variable,
    target: params.target,
  });
}
