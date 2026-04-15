/**
 * @file budgetGuard.ts
 * @description Injects a budget warning when iteration count nears the maximum.
 *
 * Fires at 80% of maxIterations (i.e. 20% remaining), warning the LLM
 * to wrap up current work and summarize progress.
 *
 * Replaces the inline budget warning from agentRuntime.ts.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';

export function createBudgetGuard(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  const hook: HookRegistration = {
    id: 'builtin:budget',
    event: 'afterIteration',
    priority: 100, // run last among afterIteration hooks
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      // ctx.iteration is 0-based and hasn't been incremented yet.
      // After this hook, iteration++ happens, so effective next iteration = ctx.iteration + 1.
      const remaining = ctx.maxIterations - (ctx.iteration + 1);
      const threshold = Math.ceil(ctx.maxIterations * 0.2);

      if (remaining === threshold && remaining > 0) {
        return {
          action: 'continue',
          injectMessage:
            `[Budget] ${remaining} iterations remaining out of ${ctx.maxIterations}. `
            + `Wrap up your current work — summarize progress and tell the user what's left if you can't finish.`,
        };
      }
    },
  };

  return {
    hooks: [hook],
    reset: () => {}, // stateless
  };
}
