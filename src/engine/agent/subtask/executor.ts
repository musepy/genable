/**
 * @file executor.ts
 * @description Pure subtask execution — accepts a complete AgentConfig,
 * creates a child AgentRuntime, runs it, returns results.
 *
 * Config assembly (tool filtering, prompt building, behavior inheritance)
 * is handled by agentFactory.ts. This file only executes.
 */

import { AgentRuntime, AgentRuntimeCanceledError } from '../agentRuntime';
import type { AgentConfig, RuntimeAccessor } from '../agentFactory';
import { createSubtaskExecutor } from '../agentFactory';

// ---------------------------------------------------------------------------
// Subtask execution context (minimal — just depth + cancel signal)
// ---------------------------------------------------------------------------

export interface SubtaskExecutionContext {
  parentAbortSignal?: AbortSignal;
  depth: number;
  maxDepth: number;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export async function executeSubtask(
  prompt: string,
  config: AgentConfig,
  context: SubtaskExecutionContext,
): Promise<{ data?: any; error?: any }> {
  // ── Fail-fast guards ──
  if (!prompt?.trim()) {
    return { error: 'Subtask requires a prompt describing the work to delegate.' };
  }
  if (context.depth >= context.maxDepth) {
    return {
      error: `Cannot create subtask: maximum recursion depth (${context.maxDepth}) reached. Complete this work inline instead.`,
    };
  }

  // ── Create child runtime with validated config ──
  const childRuntime = new AgentRuntime({
    provider: config.provider,
    tools: config.tools,
    systemPrompt: config.systemPrompt,
    ipcBridge: config.ipcBridge,
    toolExecutors: config.toolExecutors,
    maxIterations: config.maxIterations,
    behaviorConfig: config.behaviorConfig,
    onRuntimeEvent: config.onRuntimeEvent,
    contextWindow: config.contextWindow,
    loopPolicy: config.loopPolicy,
    sessionNoteStore: config.sessionNoteStore,
    disableMemoryExtractor: config.disableMemoryExtractor,
  });

  // ── Register subtask on child (if tool pool includes it AND depth allows) ──
  const childDepth = context.depth + 1;
  if (childDepth < context.maxDepth && config.tools.some(t => t.name === 'subtask')) {
    const accessor: RuntimeAccessor = {
      getCurrentIteration: () => childRuntime.getCurrentIteration(),
      getMaxIterations: () => config.maxIterations,
      getRunAbortSignal: () => childRuntime.getRunAbortSignal(),
      getActiveExecutors: () => childRuntime.getActiveExecutors(),
    };
    childRuntime.mergeToolExecutors({
      subtask: createSubtaskExecutor(config, accessor, childDepth, context.maxDepth),
    });
  }

  // ── Cancel cascade via AbortSignal ──
  const onParentAbort = () => childRuntime.cancel('Parent task canceled');
  context.parentAbortSignal?.addEventListener('abort', onParentAbort);

  try {
    const summary = await childRuntime.run(prompt);
    const createdNodes = childRuntime.getTurnCreatedNodes();
    const createdIds = childRuntime.getTurnCreatedIds();
    const stats = childRuntime.getRunStats();
    return {
      data: {
        // Structured — parent can reference nodes directly
        createdNodes,
        // Flat id list (roots + descendants) — parent's collectCreatedNodes reads
        // this to seed the inspection tracker, so mutations on subtask-created
        // descendants don't hit spurious gate rejections.
        createdIds,
        // Natural language summary — for LLM context
        summary,
        stats,
      },
    };
  } catch (error: any) {
    if (error instanceof AgentRuntimeCanceledError) {
      return { error: 'Subtask was canceled.' };
    }
    return { error: error.message || 'Subtask failed.' };
  } finally {
    context.parentAbortSignal?.removeEventListener('abort', onParentAbort);
  }
}
