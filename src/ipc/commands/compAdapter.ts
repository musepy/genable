/**
 * @file compAdapter.ts
 * @description Adapters for component tools — maps structured params to compHandlers.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleCompCreate, handleCompCombine, handleCompProp, handleCompLs, handleCompInstance } from './compHandlers';

export async function handleCreateComponent(params: any): Promise<ToolResponse> {
  return handleCompCreate({ paths: [params.node] });
}

export async function handleCombineComponents(params: any): Promise<ToolResponse> {
  return handleCompCombine({ paths: params.nodes, name: params.name });
}

export async function handleAddComponentProp(params: any): Promise<ToolResponse> {
  return handleCompProp({
    paths: [params.node],
    name: params.name,
    propType: params.type,
    defaultValue: params.default,
    bindTarget: params.bind,
  });
}

export async function handleListComponentProps(params: any): Promise<ToolResponse> {
  return handleCompLs({ paths: [params.node] });
}

export async function handleCreateInstance(params: any): Promise<ToolResponse> {
  return handleCompInstance({ paths: [params.node], parent: params.parent });
}
