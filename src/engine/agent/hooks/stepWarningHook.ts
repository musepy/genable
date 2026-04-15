/**
 * @file stepWarningHook.ts
 * @description Injects a step-remaining countdown when iteration budget is low.
 *
 * Fires on `afterToolExec` — after every single tool execution — to give
 * the LLM a persistent "N steps left" signal during the final stretch.
 *
 * Difference from budgetGuard:
 *   budgetGuard  → afterIteration, fires once at 80%, says "wrap up"
 *   stepWarning  → afterToolExec, fires every tool exec when remaining <= 5
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';

const STEP_WARNING_THRESHOLD = 5;

export function createStepWarningHook(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  // Track which iterations we've already warned on to avoid
  // spamming multiple warnings per iteration (multiple tool calls).
  let warnedIterations = new Set<number>();

  const hook: HookRegistration = {
    id: 'builtin:stepWarning',
    event: 'afterToolExec',
    priority: 90, // run after most afterToolExec hooks
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const remaining = ctx.maxIterations - (ctx.iteration + 1);

      if (remaining > STEP_WARNING_THRESHOLD || remaining <= 0) return;
      if (warnedIterations.has(ctx.iteration)) return;

      warnedIterations.add(ctx.iteration);

      return {
        action: 'continue',
        injectMessage:
          `[Step warning] Only ${remaining} step${remaining === 1 ? '' : 's'} remaining. `
          + `Prioritize completing current work.`,
      };
    },
  };

  return {
    hooks: [hook],
    reset: () => {
      warnedIterations = new Set();
    },
  };
}
