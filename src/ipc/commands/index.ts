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
import { handleLs, handleTree, handleCat } from './readHandlers';
import { handleMk, handleRm, handleMv, handleCp } from './writeHandlers';
import { handleGrep, handleSed } from './searchHandlers';
import { handleJs } from './jsHandler';
import { handleVar } from './varHandlers';
import { handleComp } from './compHandlers';
import { handleRender } from './renderHandler';
import { handleToken } from './tokenHandler';
import { handleMemoryCommand } from './memoryHandler';
import {
  handleContext, handleOutline, handleInspect,
  handleDesign, handleReplace, handleQuery,
  handleMkdir, handleMktext, handleWrite, handleLn,
} from './legacyHandlers';

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
  token: handleToken,
  // man is handled locally in sandbox — should not arrive at IPC
  man: async () => ({
    success: false as const,
    error: { code: 'LOCAL_ONLY', message: 'man command is handled locally. This is an internal routing error.' },
  }),

  // Legacy tools
  context: handleContext,
  outline: handleOutline,
  inspect: handleInspect,
  design: handleDesign,
  replace: handleReplace,
  query: handleQuery,
  mkdir: handleMkdir,
  mktext: handleMktext,
  write: handleWrite,
  ln: handleLn,
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
        message: `Unknown command "${toolName}".${hint} Available: ${Object.keys(COMMAND_HANDLERS).filter(k => !['context', 'outline', 'inspect', 'design', 'replace', 'query', 'mkdir', 'mktext', 'write', 'ln'].includes(k)).join(', ')}`,
      },
    };
  }

  return await handler(parameters);
}

// Re-export for direct use
export { handleMemoryCommand } from './memoryHandler';
