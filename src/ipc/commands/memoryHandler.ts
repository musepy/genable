/**
 * @file memoryHandler.ts
 * @description Virtual path handler for /.agent/memory/ — persistent memory store.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { memoryList, memoryGet, memoryGetAll, memorySet, memoryDelete } from '../handlers/memoryStore';

const MEMORY_PREFIX = '/.agent/memory';

export function isMemoryPath(path: string | undefined): boolean {
  if (!path) return false;
  return path === MEMORY_PREFIX || path === MEMORY_PREFIX + '/' || path.startsWith(MEMORY_PREFIX + '/');
}

function extractMemoryKey(path: string): string {
  const after = path.slice(MEMORY_PREFIX.length);
  return after.replace(/^\//, '').replace(/\/$/, '');
}

export async function handleMemoryCommand(toolName: string, parameters: any): Promise<ToolResponse | null> {
  const path: string | undefined = parameters.path;
  if (!isMemoryPath(path)) return null;

  const key = extractMemoryKey(path!);

  switch (toolName) {
    case 'ls': {
      const keys = await memoryList();
      if (keys.length === 0) {
        return { data: { listing: '(empty)', path: MEMORY_PREFIX, count: 0, hint: 'Use mk to create memories: mk /.agent/memory/key text -- value' } };
      }
      const listing = keys.map(k => k).join('\n');
      return { data: { listing, path: MEMORY_PREFIX, count: keys.length } };
    }

    case 'tree': {
      const keys = await memoryList();
      const lines = ['.agent/memory/'];
      for (let i = 0; i < keys.length; i++) {
        const prefix = i === keys.length - 1 ? '└── ' : '├── ';
        lines.push(prefix + keys[i]);
      }
      return { data: { tree: lines.join('\n'), count: keys.length } };
    }

    case 'cat': {
      if (!key) {
        const all = await memoryGetAll();
        if (Object.keys(all).length === 0) {
          return { data: { memories: {}, hint: 'No memories stored. Use mk /.agent/memory/key text -- value' } };
        }
        return { data: { memories: all } };
      }
      const value = await memoryGet(key);
      if (value === undefined) {
        const keys = await memoryList();
        return { error: { code: 'NOT_FOUND', message: `Memory "${key}" not found. Available: ${keys.join(', ') || '(none)'}` } };
      }
      return { data: { key, value } };
    }

    case 'mk': {
      if (!key) {
        return { error: { code: 'MISSING_KEY', message: 'Memory key required. Usage: mk /.agent/memory/my-key text -- value to store' } };
      }
      const textContent = parameters.textContent;
      if (!textContent) {
        return { error: { code: 'MISSING_VALUE', message: `No value provided. Usage: mk /.agent/memory/${key} text -- value to store` } };
      }
      await memorySet(key, textContent);
      return { data: { key, stored: textContent, hint: 'Memory saved. Persists across sessions.' } };
    }

    case 'rm': {
      if (!key) {
        return { error: { code: 'MISSING_KEY', message: 'Specify which memory to delete. Usage: rm /.agent/memory/key' } };
      }
      const existed = await memoryDelete(key);
      if (!existed) {
        return { error: { code: 'NOT_FOUND', message: `Memory "${key}" not found.` } };
      }
      return { data: { key, deleted: true } };
    }

    default:
      return { error: { code: 'UNSUPPORTED', message: `Command "${toolName}" is not supported on memory paths. Use ls, cat, mk, rm.` } };
  }
}
