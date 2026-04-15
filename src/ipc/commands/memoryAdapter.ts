/**
 * @file memoryAdapter.ts
 * @description Adapters for memory tools — maps structured params to memoryStore.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { memoryList, memoryGet, memoryGetAll, memorySet, memoryDelete } from '../handlers/memoryStore';

export async function handleListMemories(params: any): Promise<ToolResponse> {
  if (params.key) {
    const value = await memoryGet(params.key);
    if (value === undefined) {
      const keys = await memoryList();
      return { error: `Memory "${params.key}" not found. Available: ${keys.join(', ') || '(none)'}` };
    }
    return { data: { key: params.key, value } };
  }
  const all = await memoryGetAll();
  const keys = Object.keys(all);
  if (keys.length === 0) {
    return { data: { memories: {}, count: 0 } };
  }
  return { data: { memories: all, count: keys.length } };
}

export async function handleSaveMemory(params: any): Promise<ToolResponse> {
  if (!params.key || !params.value) {
    return { error: 'Both key and value are required.' };
  }
  await memorySet(params.key, params.value);
  return { data: { key: params.key, saved: true } };
}

export async function handleDeleteMemory(params: any): Promise<ToolResponse> {
  if (!params.key) {
    return { error: 'Key is required.' };
  }
  const existed = await memoryDelete(params.key);
  if (!existed) {
    return { error: `Memory "${params.key}" not found.` };
  }
  return { data: { key: params.key, deleted: true } };
}
