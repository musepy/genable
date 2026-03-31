/**
 * @file commands/index.ts
 * @description Command handler registry — maps tool/command names to handler functions.
 *
 * This is the single dispatch table for all IPC tool calls.
 * Each handler is self-contained: validates args, executes, formats output.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';

// Command handler groups
import { registerSessionNodes } from './pathResolver';
import { handleTree, handleCat } from './readHandlers';
import { handleMk, handleRm, handleMv, handleCp } from './writeHandlers';
import { handleGrep, handleSed } from './searchHandlers';
import { handleJs } from './jsHandler';
import { handleVar } from './varHandlers';
import { handleComp } from './compHandlers';
import { handleJsx } from './jsxHandler';
import { handleInspect } from './inspectHandler';
import { handleEdit } from './editHandler';
import { handleMemoryCommand } from './memoryHandler';
import { handleScanTokens } from './tokenScanner';
// New tool adapters
import { handleSearch } from './searchAdapter';
import { handleStructure } from './structureAdapter';
import { handleVarTool } from './varAdapter';
import { handleCompTool } from './compAdapter';

// ── Command handler type ──

export type CommandHandler = (parameters: any) => Promise<ToolResponse>;

// ── Dispatch table ──

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  // First-class tools (LLM-facing)
  jsx: handleJsx,
  inspect: handleInspect,
  edit: handleEdit,
  search: handleSearch,
  structure: handleStructure,
  js: handleJs,
  var: handleVarTool,
  comp: handleCompTool,
  // knowledge is handled locally in sandbox — should not arrive at IPC
  knowledge: async () => ({
    error: { code: 'LOCAL_ONLY', message: 'knowledge is handled locally. This is an internal routing error.' },
  }),
  // Legacy command names — kept for backward compat during transition
  tree: handleTree,
  cat: handleCat,
  mk: handleMk,
  rm: handleRm,
  mv: handleMv,
  cp: handleCp,
  grep: handleGrep,
  sed: handleSed,
  'scan-tokens': handleScanTokens,
};

// ── Dispatch function ──

export async function dispatchCommand(toolName: string, parameters: any): Promise<ToolResponse> {
  // Virtual path interception: /.agent/memory/
  const memoryResponse = await handleMemoryCommand(toolName, parameters);
  if (memoryResponse) return memoryResponse;

  const handler = COMMAND_HANDLERS[toolName];
  if (!handler) {
    return {
      error: {
        code: 'UNKNOWN_TOOL',
        message: `Unknown tool "${toolName}". Available: ${Object.keys(COMMAND_HANDLERS).join(', ')}`,
      },
    };
  }

  const result = await handler(parameters);

  // Auto-register created node IDs for session-scoped path preference
  if (!result.error && result.data?.idMap) {
    registerSessionNodes(Object.values(result.data.idMap));
  }

  return result;
}

// Re-export for direct use
export { handleMemoryCommand } from './memoryHandler';
