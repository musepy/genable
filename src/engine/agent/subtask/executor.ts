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
import { resolveAgentType } from './agentTypes';
import type { AgentTypeDefinition } from './agentTypes';
import { buildStaticSystemPrompt } from '../../llm-client/context/system';

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

  const agentType = context.agentType ?? resolveAgentType('create');

  // Filter tools by agent type whitelist
  const allowedToolSet = new Set(agentType.tools);
  const filteredTools = context.tools.filter(t => allowedToolSet.has(t.name));

  // Build agent-type-specific system prompt:
  // rolePreamble (identity anchoring) + base system prompt (with filtered tools)
  const basePrompt = context.providerRef
    ? buildStaticSystemPrompt(filteredTools, context.providerRef)
    : context.systemPrompt;
  const childSystemPrompt = agentType.rolePreamble + '\n\n' + basePrompt;

  // Create child runtime
  const childDepth = context.depth + 1;
  const childMaxIterations = Math.min(context.maxIterations, agentType.maxIterations);

  const childRuntime = new AgentRuntime({
    provider: context.provider,
    tools: filteredTools,
    systemPrompt: childSystemPrompt,
    ipcBridge: context.ipcBridge,
    toolExecutors: context.toolExecutors,
    maxIterations: childMaxIterations,
    onRuntimeEvent: context.onRuntimeEvent,
  });

  // Register subtask executor on child (for nested recursion up to maxDepth)
  if (childDepth < context.maxDepth) {
    childRuntime.mergeToolExecutors({
      subtask: async (args: any) => {
        const nestedType = resolveAgentType(args?.type);
        const childContext: SubtaskContext = {
          ...context,
          depth: childDepth,
          agentType: nestedType,
          maxIterations: Math.min(Math.floor(childMaxIterations / 2), nestedType.maxIterations),
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
    // Convenience field: rootNodeIds lets the parent agent reference the
    // child's creations directly without parsing the natural-language summary.
    // Failure path intentionally has no partialNodes — we don't try to
    // hand back half-completed work; the parent retries cleanly or surfaces
    // the error to the user.
    return {
      data: {
        result,
        rootNodeIds: childRuntime.getTurnCreatedNodeIds(),
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
