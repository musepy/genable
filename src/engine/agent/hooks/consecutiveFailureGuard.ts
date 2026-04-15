/**
 * @file consecutiveFailureGuard.ts
 * @description Tracks consecutive iterations where ALL tool calls fail.
 *
 * After N consecutive all-fail iterations, injects a strategy-change directive
 * to force the LLM to re-examine canvas state or change approach.
 *
 * Replaces the inline consecutiveFailure guard from agentRuntime.ts.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';
import { AGENT_RUNTIME_CONSTANTS } from '../constants';

interface ConsecutiveFailureState {
  consecutiveFailIterations: number;
}

export function createConsecutiveFailureGuard(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  const state: ConsecutiveFailureState = { consecutiveFailIterations: 0 };

  const hook: HookRegistration = {
    id: 'builtin:consecutiveFailure',
    event: 'afterIteration',
    priority: 50,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      if (!ctx.iterationToolResults || ctx.iterationToolResults.length === 0) return;

      const allFailed = ctx.iterationToolResults.every(
        r => r.result?.error != null
      );

      if (allFailed) {
        state.consecutiveFailIterations++;
      } else {
        state.consecutiveFailIterations = 0;
      }

      if (state.consecutiveFailIterations >= AGENT_RUNTIME_CONSTANTS.CONSECUTIVE_FAILURE_THRESHOLD) {
        return {
          action: 'continue',
          injectMessage:
            `⚠ ${state.consecutiveFailIterations} consecutive iterations have ALL failed. Your current approach is not working. `
            + `STOP and change strategy: use context/outline to re-examine the canvas state, `
            + `verify node IDs exist, or explain the blocker to the user.`,
        };
      }
    },
  };

  return {
    hooks: [hook],
    reset: () => {
      state.consecutiveFailIterations = 0;
    },
  };
}
