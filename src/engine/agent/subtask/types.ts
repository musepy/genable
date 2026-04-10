/**
 * @file types.ts
 * @description Types for the subtask (bounded self-recursion) system.
 */

import { LLMProvider } from '../../llm-client/providers/types';
import { ToolDefinition } from '../tools/types';
import type { IpcBridge } from '../ipcBridge';
import type { AgentRuntimeEvent } from '../../../shared/protocol/agentRuntimeEvents';
import type { AgentTypeDefinition } from './agentTypes';

export interface SubtaskContext {
  /** LLM provider (shared with parent). */
  provider: LLMProvider;
  /** IPC bridge for tool execution (shared with parent). */
  ipcBridge?: IpcBridge;
  /** Static system prompt (shared with parent). */
  systemPrompt: string;
  /** Tool definitions (shared with parent). */
  tools: ToolDefinition[];
  /** Tool executors from parent (shared). */
  toolExecutors?: Record<string, import('../tools/types').ToolExecutor>;
  /** Maximum iterations for this subtask. */
  maxIterations: number;
  /** Current recursion depth (0 = top-level agent). */
  depth: number;
  /** Maximum allowed recursion depth. */
  maxDepth: number;
  /** Parent's cancel check — if parent is canceled, child should stop too. */
  isParentCanceled: () => boolean;
  /** Event handler — child events are forwarded to parent. */
  onRuntimeEvent?: (event: AgentRuntimeEvent) => void;
  /** Agent type definition (controls tools, prompt, budget). */
  agentType?: AgentTypeDefinition;
  /** LLM provider reference for rebuilding system prompt with filtered tools. */
  providerRef?: { getToolSystemInstruction: (tools: ToolDefinition[]) => string };
}
