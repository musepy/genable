/**
 * @file announceIntentLint.ts
 * @description Stop hook — reject turn-end when the LLM announced an action in
 * text but didn't emit a tool call.
 *
 * Failure mode this catches:
 *   LLM responds with "Now let me fix the layout" / "I'll update the cards" /
 *   "Next I'll verify" and zero tool calls. The harness would otherwise treat
 *   this as turn end. This hook detects the announce-intent pattern and forces
 *   another iteration with a corrective user message.
 *
 * Why in the harness and not the prompt:
 *   Prompt rules ("don't end with text when you meant to act") are advisory —
 *   under repeated tool failure, the LLM's training prior ("summarize when
 *   stuck") overrides the rule. Only the while-loop can guarantee the signal.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';

/**
 * Regex matching common announce-intent phrases. Case-insensitive.
 * Each alternative is anchored to word boundaries where practical so that
 * "well, I'll do X" still trips but "until they fill in..." does not.
 */
const INTENT_PATTERN =
  /\b(let me|i'll\b|i will|now i(?:'ll)?|next i(?:'ll)?|i'm going to|going to (?:fix|update|add|create|adjust|refine)|let's (?:fix|update|add|create|adjust))\b/i;

const MAX_CONTINUATIONS = 2;

export function createAnnounceIntentLint(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  let continuations = 0;

  const hook: HookRegistration = {
    id: 'builtin:announceIntentLint',
    event: 'beforeTurnEnd',
    priority: 40,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const text = (ctx.responseText || '').trim();
      if (!text) return; // empty response is handled elsewhere

      if (!INTENT_PATTERN.test(text)) return;

      if (continuations >= MAX_CONTINUATIONS) {
        // Don't trap the LLM forever — after a couple corrections, let the turn end.
        return;
      }
      continuations++;

      return {
        action: 'continue',
        code: 'ANNOUNCE_INTENT',
        injectMessage:
          'Your previous response described an upcoming action in text but did not emit a tool call. ' +
          'If the task needs more work, emit the tool call that performs the next step now. ' +
          'If the task is complete or blocked, state that explicitly (no "let me…" / "I\'ll…" phrasing) so the turn can close.',
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
