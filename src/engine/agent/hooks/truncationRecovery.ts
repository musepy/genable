/**
 * @file truncationRecovery.ts
 * @description Stop hook — when the final LLM response was cut off by the
 * provider's max-output-tokens limit, inject a diagnosis that names the real
 * cause (output truncated, not "you forgot props") and a concrete mitigation
 * (smaller batch).
 *
 * Failure mode this catches:
 *   LLM plans a large batch (e.g. edit of 17 nodes). The provider server
 *   truncates the response at max_tokens. The partial JSON reaches the
 *   runtime with props fields stubbed as the ellipsis character "{…}".
 *   Executor rejects with "No props or content", LLM misreads that as
 *   "I forgot props" and retries the same too-large batch, looping.
 *
 * Why in the harness:
 *   finishReason === 'length' is a ground-truth signal the provider gives us.
 *   The LLM doesn't always notice its own truncation. The runtime can point
 *   at the real cause once, and redirect the next plan.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';

const MAX_CONTINUATIONS = 1;

export function createTruncationRecovery(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  let continuations = 0;

  const hook: HookRegistration = {
    id: 'builtin:truncationRecovery',
    event: 'beforeTurnEnd',
    priority: 30,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      if (ctx.finishReason !== 'length') return;

      if (continuations >= MAX_CONTINUATIONS) return;
      continuations++;

      return {
        action: 'continue',
        code: 'TRUNCATED',
        injectMessage:
          'Your previous response was cut off by the output-token limit. ' +
          'The errors you saw ("No props or content", malformed JSON) are a symptom, not the cause. ' +
          'Retry the same intent with a smaller batch: at most 4 nodes per edit call, ' +
          'and split large jsx markups into one root frame plus follow-up jsx calls for each child region.',
      };
    },
  };

  return {
    hooks: [hook],
    reset: () => {
      continuations = 0;
    },
  };
}
