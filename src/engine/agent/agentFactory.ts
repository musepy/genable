/**
 * @file agentFactory.ts
 * @description Agent configuration assembly + validation + child derivation.
 *
 * Core principle: parent and child agents are the same AgentRuntime.
 * This module handles the CONFIG differences — tool filtering, prompt building,
 * behavior inheritance, executor assembly. The runtime itself is unchanged.
 */

import type { LLMProvider, ToolCallBlock, LLMResponse } from '../llm-client/providers/types';
import type { ToolDefinition, ToolExecutor } from './tools/types';
import type { AgentBehaviorConfig } from './agentBehaviorConfig';
import type { AgentLoopPolicy } from './agentLoopPolicy';
import type { AgentRuntimeEvent } from '../../shared/protocol/agentRuntimeEvents';
import type { IpcBridge } from './ipcBridge';
import type { AgentTypeDefinition } from './subtask/agentTypes';
import { resolveAgentType, buildChildSystemPrompt } from './subtask/agentTypes';
import { executeSubtask } from './subtask/executor';

// ---------------------------------------------------------------------------
// AgentConfig — complete, validated config for any agent (parent or child)
// ---------------------------------------------------------------------------

export interface AgentConfig {
  provider: LLMProvider;
  tools: ToolDefinition[];
  toolExecutors: Record<string, ToolExecutor>;
  systemPrompt: string;
  behaviorConfig: AgentBehaviorConfig;
  maxIterations: number;
  ipcBridge?: IpcBridge;
  onRuntimeEvent?: (event: AgentRuntimeEvent) => void;
  contextWindow?: number;
  loopPolicy?: Partial<AgentLoopPolicy>;
  onToolCall?: (tc: ToolCallBlock) => void;
  onToolResult?: (tc: ToolCallBlock, result: any) => void;
  onIterationStart?: (iteration: number) => void;
  onIteration?: (iteration: number, response: LLMResponse) => void;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Tools that AgentRuntime registers itself (need instance state). */
const RUNTIME_BOUND_TOOLS = new Set(['ask_user']);

/**
 * Fail-fast: every tool in definitions must have an executor path
 * (local executor, runtime-bound, or IPC fallback).
 */
export function validateToolExecutors(
  tools: ToolDefinition[],
  executors: Record<string, ToolExecutor>,
  ipcBridge?: IpcBridge,
  runtimeBoundTools: Set<string> = RUNTIME_BOUND_TOOLS,
): void {
  const missing: string[] = [];
  for (const tool of tools) {
    if (executors[tool.name]) continue;
    if (runtimeBoundTools.has(tool.name)) continue;
    if (ipcBridge) continue;
    missing.push(tool.name);
  }
  if (missing.length > 0) {
    throw new Error(
      `[AgentFactory] Tools without executor or IPC: ${missing.join(', ')}. ` +
      `Provide executors, add IPC bridge, or remove from tool list.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Child config builder
// ---------------------------------------------------------------------------

/**
 * Derive a child AgentConfig from a parent's config + agent type definition.
 * Handles: tool filtering, prompt building, behavior inheritance, executor filtering, validation.
 */
export function buildChildConfig(
  parentConfig: AgentConfig,
  agentType: AgentTypeDefinition,
): AgentConfig {
  // 1. Filter tools by agent type whitelist
  const allowedSet = new Set(agentType.tools);
  const filteredTools = parentConfig.tools.filter(t => allowedSet.has(t.name));

  // 2. Build independent system prompt
  const childPrompt = buildChildSystemPrompt(
    filteredTools,
    parentConfig.provider,
    agentType,
  );

  // 3. Merge behavior config (parent base + agent type overrides)
  const childBehavior: AgentBehaviorConfig = {
    ...parentConfig.behaviorConfig,
    ...agentType.behaviorOverrides,
  };

  // 4. Filter executors to match filtered tools (don't leak parent-only executors)
  const childExecutors: Record<string, ToolExecutor> = {};
  for (const tool of filteredTools) {
    const exec = parentConfig.toolExecutors[tool.name];
    if (exec) childExecutors[tool.name] = exec;
  }

  // 5. Validate completeness
  validateToolExecutors(filteredTools, childExecutors, parentConfig.ipcBridge);

  // 6. Budget: use parent's remaining budget, capped by agent type max
  const childMaxIterations = Math.min(
    parentConfig.maxIterations,
    agentType.maxIterations,
  );

  return {
    provider: parentConfig.provider,
    tools: filteredTools,
    toolExecutors: childExecutors,
    systemPrompt: childPrompt,
    behaviorConfig: childBehavior,
    maxIterations: childMaxIterations,
    ipcBridge: parentConfig.ipcBridge,
    onRuntimeEvent: parentConfig.onRuntimeEvent,
    contextWindow: parentConfig.contextWindow,
  };
}

// ---------------------------------------------------------------------------
// Subtask executor factory
// ---------------------------------------------------------------------------

/**
 * Runtime accessor interface — the minimal surface createSubtaskExecutor needs.
 * Avoids importing AgentRuntime (prevents circular dependency).
 */
export interface RuntimeAccessor {
  getCurrentIteration(): number;
  getMaxIterations(): number;
  getRunAbortSignal(): AbortSignal | undefined;
  getActiveExecutors(): Record<string, ToolExecutor>;
}

/**
 * Create a subtask executor closure for a given agent.
 * Called once per AgentRuntime instance. The closure captures the parent config
 * and reads LIVE state (iteration, executors, abort signal) at invocation time.
 */
export function createSubtaskExecutor(
  parentConfig: AgentConfig,
  runtime: RuntimeAccessor,
  depth: number,
  maxDepth: number,
): ToolExecutor {
  return async (args: any) => {
    const agentType = resolveAgentType(args?.type);
    const remaining = runtime.getMaxIterations() - runtime.getCurrentIteration();

    if (remaining <= 1) {
      return { error: 'Not enough iteration budget remaining to delegate a subtask.' };
    }

    const childConfig = buildChildConfig(
      {
        ...parentConfig,
        toolExecutors: runtime.getActiveExecutors(),
        maxIterations: Math.floor(remaining / 2),
      },
      agentType,
    );

    return executeSubtask(args?.prompt || args?.input || '', childConfig, {
      parentAbortSignal: runtime.getRunAbortSignal(),
      depth: depth + 1,
      maxDepth,
    });
  };
}
