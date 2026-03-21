/**
 * @file commands/index.ts
 * @description Command handler registry — maps command names to handler functions.
 *
 * This is the single dispatch table for all IPC tool calls.
 * Each handler is self-contained: validates args, executes, formats output.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { findClosestCommand } from '../../engine/agent/tools/unified/commandRegistry';

// Command handler groups
import { registerSessionNodes } from './pathResolver';
import { handleLs, handleTree, handleCat } from './readHandlers';
import { handleMk, handleRm, handleMv, handleCp } from './writeHandlers';
import { handleGrep, handleSed } from './searchHandlers';
import { handleJs } from './jsHandler';
import { handleVar } from './varHandlers';
import { handleComp } from './compHandlers';
import { handleRender } from './renderHandler';
import { handleJsx } from './jsxHandler';
import { handleCreate } from './createHandler';
import { handleInspect } from './inspectHandler';
import { handleEdit } from './editHandler';
import { handleToken } from './tokenHandler';
import { handleMemoryCommand } from './memoryHandler';
import { handleScanTokens } from './tokenScanner';

// ── Command handler type ──

export type CommandHandler = (parameters: any) => Promise<ToolResponse>;

// ── Dispatch table ──

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  // Unix CLI commands
  ls: handleLs,
  tree: handleTree,
  cat: handleCat,
  mk: handleMk,
  rm: handleRm,
  mv: handleMv,
  cp: handleCp,
  grep: handleGrep,
  sed: handleSed,
  js: handleJs,
  var: handleVar,
  comp: handleComp,
  render: handleRender,
  jsx: handleJsx,
  create: handleCreate,
  inspect: handleInspect,
  edit: handleEdit,
  token: handleToken,
  'scan-tokens': handleScanTokens,
  // man is handled locally in sandbox — should not arrive at IPC
  man: async () => ({
    success: false as const,
    error: { code: 'LOCAL_ONLY', message: 'man command is handled locally. This is an internal routing error.' },
  }),
};

// ── Dispatch function ──

export async function dispatchCommand(toolName: string, parameters: any): Promise<ToolResponse> {
  // Virtual path interception: /.agent/memory/
  const memoryResponse = await handleMemoryCommand(toolName, parameters);
  if (memoryResponse) return memoryResponse;

  const handler = COMMAND_HANDLERS[toolName];
  if (!handler) {
    const suggestion = findClosestCommand(toolName);
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    return {
      success: false,
      error: {
        code: 'UNKNOWN_TOOL',
        message: `Unknown command "${toolName}".${hint} Available: ${Object.keys(COMMAND_HANDLERS).join(', ')}`,
      },
    };
  }

  const result = await handler(parameters);

  // Auto-register created node IDs for session-scoped path preference
  if (result.success && result.data?.idMap) {
    registerSessionNodes(Object.values(result.data.idMap));
  }

  return result;
}

// Re-export for direct use
export { handleMemoryCommand } from './memoryHandler';
