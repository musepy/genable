/**
 * @file handler.ts
 * @description Virtual path handler for /.agent/scratch/ — session-scoped scratchpad.
 * Follows the same pattern as memoryHandler.ts but operates on the in-memory store
 * (sandbox-local, zero IPC latency).
 */

import type { ToolResponse } from '../tools/types';
import { scratchList, scratchGet, scratchGetAll, scratchSet, scratchDelete } from './store';

const SCRATCH_PREFIX = '/.agent/scratch';

export function isScratchPath(path: string | undefined): boolean {
  if (!path) return false;
  return path === SCRATCH_PREFIX || path === SCRATCH_PREFIX + '/' || path.startsWith(SCRATCH_PREFIX + '/');
}

function extractScratchKey(path: string): string {
  const after = path.slice(SCRATCH_PREFIX.length);
  return after.replace(/^\//, '').replace(/\/$/, '');
}

export async function handleScratchCommand(toolName: string, parameters: any): Promise<ToolResponse | null> {
  const path: string | undefined = parameters.path;
  if (!isScratchPath(path)) return null;

  const key = extractScratchKey(path!);

  switch (toolName) {
    case 'ls': {
      const keys = scratchList();
      if (keys.length === 0) {
        return { success: true, data: { listing: '(empty)', path: SCRATCH_PREFIX, count: 0, hint: 'Use mk to create notes: mk /.agent/scratch/key text -- value' } };
      }
      const listing = keys.map(k => k).join('\n');
      return { success: true, data: { listing, path: SCRATCH_PREFIX, count: keys.length } };
    }

    case 'tree': {
      const keys = scratchList();
      const lines = ['.agent/scratch/'];
      for (let i = 0; i < keys.length; i++) {
        const prefix = i === keys.length - 1 ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
        lines.push(prefix + keys[i]);
      }
      return { success: true, data: { tree: lines.join('\n'), count: keys.length } };
    }

    case 'cat': {
      if (!key) {
        const all = scratchGetAll();
        if (Object.keys(all).length === 0) {
          return { success: true, data: { notes: {}, hint: 'No notes stored. Use mk /.agent/scratch/key text -- value' } };
        }
        return { success: true, data: { notes: all } };
      }
      const value = scratchGet(key);
      if (value === undefined) {
        const keys = scratchList();
        return { success: false, error: { code: 'NOT_FOUND', message: `Scratch note "${key}" not found. Available: ${keys.join(', ') || '(none)'}` } };
      }
      return { success: true, data: { key, value } };
    }

    case 'mk': {
      if (!key) {
        return { success: false, error: { code: 'MISSING_KEY', message: 'Scratch key required. Usage: mk /.agent/scratch/my-key text -- value to store' } };
      }
      const textContent = parameters.textContent;
      if (!textContent) {
        return { success: false, error: { code: 'MISSING_VALUE', message: `No value provided. Usage: mk /.agent/scratch/${key} text -- value to store` } };
      }
      const result = scratchSet(key, textContent);
      if (!result.success) {
        return { success: false, error: { code: 'STORE_ERROR', message: result.error! } };
      }
      return { success: true, data: { key, stored: textContent, hint: 'Note saved. Session-scoped — cleared when session ends.' } };
    }

    case 'rm': {
      if (!key) {
        return { success: false, error: { code: 'MISSING_KEY', message: 'Specify which note to delete. Usage: rm /.agent/scratch/key' } };
      }
      const existed = scratchDelete(key);
      if (!existed) {
        return { success: false, error: { code: 'NOT_FOUND', message: `Scratch note "${key}" not found.` } };
      }
      return { success: true, data: { key, deleted: true } };
    }

    default:
      return { success: false, error: { code: 'UNSUPPORTED', message: `Command "${toolName}" is not supported on scratch paths. Use ls, cat, mk, rm.` } };
  }
}
