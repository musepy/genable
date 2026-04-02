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
// grep/sed removed — no callers after verb_noun migration
import { handleJs } from './jsHandler';
import { handleJsx } from './jsxHandler';
import { handleInspect } from './inspectHandler';
import { handleDescribe } from './describeHandler';
import { handleEdit } from './editHandler';
import { handleMemoryCommand } from './memoryHandler';
import { handleScanTokens } from './tokenScanner';
// verb_noun tool adapters
import { handleFindNodes, handleDiscoverProps, handleReplaceProps } from './searchAdapter';
import { handleDeleteNode, handleMoveNode, handleCloneNode } from './structureAdapter';
import { handleListVariables, handleCreateVariable, handleBindVariable, handleAliasVariable } from './varAdapter';
import { handleCreateComponent, handleCombineComponents, handleAddComponentProp, handleListComponentProps, handleCreateInstance } from './compAdapter';
import { handleSetText, handleSetFill, handleSetStroke, handleSetLayout } from './setterAdapter';
import { handleListMemories, handleSaveMemory, handleDeleteMemory } from './memoryAdapter';
import { handleGetSelection } from './selectionAdapter';

// ── Command handler type ──

export type CommandHandler = (parameters: any) => Promise<ToolResponse>;

// ── Dispatch table ──

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  // First-class tools (LLM-facing, verb_noun naming)
  jsx: handleJsx,
  inspect: handleInspect,
  describe: handleDescribe,
  edit: handleEdit,
  js: handleJs,
  // Search tools
  find_nodes: handleFindNodes,
  discover_props: handleDiscoverProps,
  replace_props: handleReplaceProps,
  // Structure tools
  delete_node: handleDeleteNode,
  move_node: handleMoveNode,
  clone_node: handleCloneNode,
  // Variable tools
  list_variables: handleListVariables,
  create_variable: handleCreateVariable,
  bind_variable: handleBindVariable,
  alias_variable: handleAliasVariable,
  // Component tools
  create_component: handleCreateComponent,
  combine_components: handleCombineComponents,
  add_component_prop: handleAddComponentProp,
  list_component_props: handleListComponentProps,
  create_instance: handleCreateInstance,
  // Setters (focused, single-intent — delegate to editHandler)
  set_text: handleSetText,
  set_fill: handleSetFill,
  set_stroke: handleSetStroke,
  set_layout: handleSetLayout,
  // Memory (persistent across sessions)
  list_memories: handleListMemories,
  save_memory: handleSaveMemory,
  delete_memory: handleDeleteMemory,
  // Selection (opt-in, LLM calls when needed)
  get_selection: handleGetSelection,
  // knowledge is handled locally in sandbox — should not arrive at IPC
  knowledge: async () => ({
    error: 'knowledge is handled locally. This is an internal routing error.',
  }),
  // Legacy command names — internal use only (adapters + scratchpad routing)
  tree: handleTree,
  cat: handleCat,
  mk: handleMk,
  rm: handleRm,
  mv: handleMv,
  cp: handleCp,
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
      error: `Unknown tool "${toolName}". Available: ${Object.keys(COMMAND_HANDLERS).join(', ')}`,
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
