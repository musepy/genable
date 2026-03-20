/**
 * @file partialFailureGuard.ts
 * @description Detects PARTIAL_FAILURE tool results and injects mandatory repair instructions.
 *
 * When a tool call partially succeeds (some ops OK, some failed), this hook
 * collects the error summaries and injects a repair directive so the LLM
 * fixes the failures before creating new content.
 *
 * Replaces the inline partialFailure guard from agentRuntime.ts.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';

export function createPartialFailureGuard(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  const hook: HookRegistration = {
    id: 'builtin:partialFailure',
    event: 'afterIteration',
    priority: 40, // run before consecutiveFailure (50)
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      if (!ctx.iterationToolResults || ctx.iterationToolResults.length === 0) return;

      const partialFailures = ctx.iterationToolResults
        .filter(r => r.result?.error?.code === 'PARTIAL_FAILURE')
        .map(r => r.result);

      if (partialFailures.length === 0) return;

      const errorSummaries: string[] = [];
      for (const pf of partialFailures) {
        const errors = pf.data?.errors;
        if (Array.isArray(errors)) {
          for (const e of errors.slice(0, 5)) {
            errorSummaries.push(`- ${e.op}: ${e.error}`);
          }
        }
      }

      if (errorSummaries.length > 0) {
        return {
          action: 'continue',
          injectMessage:
            `⚠ PARTIAL_FAILURE detected. Before proceeding, you MUST fix these errors:\n`
            + errorSummaries.join('\n')
            + `\nUse the idMap from successful nodes to reference them. Do NOT create new content until these are resolved.`,
        };
      }
    },
  };

  return {
    hooks: [hook],
    reset: () => {}, // stateless
  };
}
