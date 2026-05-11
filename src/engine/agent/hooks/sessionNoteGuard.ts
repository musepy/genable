/**
 * @file sessionNoteGuard.ts
 * @description Turn-end guardrail: enforce that the agent uses the session
 * scratchpad before producing the final text.
 *
 * Policy (matches what the create-page skill prompts for):
 *  - First turn of a session  → must WRITE at least one note (typically
 *    `decisions`) before ending. Forced commit-before-act.
 *  - Every turn (incl. first) → must have READ or WRITTEN at least one note,
 *    so the agent has consulted / updated its own scratchpad.
 *  - Each turn fires the nudge at most ONCE — second time it just lets the
 *    turn end, so a stubborn LLM doesn't burn iterations on the same warning.
 *
 * Why this lives here, not as prompt-only nudge:
 *   Prompt nudges drift. A runtime-enforced gate makes the scratchpad usage
 *   non-optional. The injected message names the exact tool call to make.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';
import type { SessionNoteStore } from '../session/SessionNoteStore';

export interface SessionNoteGuardOptions {
  getStore: () => SessionNoteStore;
}

export function createSessionNoteGuard(opts: SessionNoteGuardOptions): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  let firstTurnWriteOccurred = false;
  const turnsAlreadyNudged = new Set<string>();

  const hook: HookRegistration = {
    id: 'builtin:sessionNoteGuard',
    event: 'beforeTurnEnd',
    // After truncationRecovery (30) but before any general-purpose stop hooks
    // so our nudge comes out specific.
    priority: 35,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const store = opts.getStore();

      // The runtime resets touched/written flags at run() start, so these
      // booleans reflect *this turn only*.
      const touched = store.hasTouchedThisTurn();
      const written = store.hasWrittenThisTurn();

      // Per-turn nudge limiter (don't fire twice on the same turn — uses
      // iteration as a coarse turn-id key).
      const turnKey = `iter:${ctx.iteration}`;
      if (turnsAlreadyNudged.has(turnKey)) return;

      // FIRST TURN: must have written at least once.
      if (!firstTurnWriteOccurred) {
        if (written) {
          firstTurnWriteOccurred = true;
        } else {
          turnsAlreadyNudged.add(turnKey);
          return {
            action: 'continue',
            code: 'SESSION_NOTE_REQUIRED',
            injectMessage:
              'Before ending this first turn, write your design decisions to the session scratchpad. '
              + 'Call: session_note({action:"write", key:"decisions", value:"<style picked, accent token, font, hero treatment, etc.>"}). '
              + 'Optionally also write key:"plan" describing the steps you took. '
              + 'After writing, you may finish the turn.',
          };
        }
      }

      // SUBSEQUENT TURNS: must have at least read OR written.
      if (firstTurnWriteOccurred && !touched) {
        turnsAlreadyNudged.add(turnKey);
        return {
          action: 'continue',
          code: 'SESSION_NOTE_REQUIRED',
          injectMessage:
            'Before ending this turn, consult your session scratchpad. '
            + 'Call: session_note({action:"list"}) to see what\'s recorded, '
            + 'then read the relevant entries (decisions, todo) and update them if anything changed this turn. '
            + 'Use session_note({action:"write", key:"todo", value:"..."}) to capture carry-over.',
        };
      }
    },
  };

  return {
    hooks: [hook],
    reset: () => {
      firstTurnWriteOccurred = false;
      turnsAlreadyNudged.clear();
    },
  };
}
