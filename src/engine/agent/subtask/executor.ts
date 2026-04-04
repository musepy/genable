/**
 * @file executor.ts
 * @description Creates and runs a child AgentRuntime for delegated subtasks.
 *
 * Constraints:
 * - Max recursion depth: 2 (configurable via SubtaskContext.maxDepth)
 * - Child budget: min(parentRemaining / 2, 20)
 * - Shared: provider, ipcBridge, systemPrompt, tools
 * - Independent: turnMessages, summary, iteration counter
 * - Cancel cascades from parent to child
 */

import { AgentRuntime, AgentRuntimeCanceledError } from '../agentRuntime';
import { SubtaskContext } from './types';

const MAX_CHILD_ITERATIONS = 20;

export async function executeSubtask(
  prompt: string,
  context: SubtaskContext,
): Promise<{ data?: any; error?: any }> {
  // Depth guard
  if (context.depth >= context.maxDepth) {
    return {
      error: `Cannot create subtask: maximum recursion depth (${context.maxDepth}) reached. Complete this work inline instead.`,
    };
  }

  if (!prompt || prompt.trim().length === 0) {
    return {
      error: 'Subtask requires a prompt describing the work to delegate.',
    };
  }

  // Create child runtime
  const childDepth = context.depth + 1;
  const childMaxIterations = Math.min(context.maxIterations, MAX_CHILD_ITERATIONS);

  const childRuntime = new AgentRuntime({
    provider: context.provider,
    tools: context.tools,
    systemPrompt: context.systemPrompt,
    ipcBridge: context.ipcBridge,
    toolExecutors: context.toolExecutors,
    maxIterations: childMaxIterations,
    onRuntimeEvent: context.onRuntimeEvent,
  });

  // Register subtask executor on child (for nested recursion up to maxDepth)
  if (childDepth < context.maxDepth) {
    childRuntime.mergeToolExecutors({
      subtask: async (args: any) => {
        const childContext: SubtaskContext = {
          ...context,
          depth: childDepth,
          maxIterations: Math.min(Math.floor(childMaxIterations / 2), MAX_CHILD_ITERATIONS),
          isParentCanceled: () => context.isParentCanceled(),
        };
        return executeSubtask(args?.prompt || args?.input || '', childContext);
      },
    });
  }

  // Cancel cascade: poll parent cancel state
  const cancelInterval = setInterval(() => {
    if (context.isParentCanceled()) {
      childRuntime.cancel('Parent task canceled');
    }
  }, 200);

  try {
    const result = await childRuntime.run(prompt);
    return {
      data: {
        result,
        stats: childRuntime.getRunStats(),
      },
    };
  } catch (error: any) {
    if (error instanceof AgentRuntimeCanceledError) {
      return {
        error: 'Subtask was canceled.',
      };
    }
    return {
      error: error.message || 'Subtask failed.',
    };
  } finally {
    clearInterval(cancelInterval);
  }
}
