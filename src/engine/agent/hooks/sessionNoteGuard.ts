/**
 * @file sessionNoteGuard.ts
 * @description Turn-end guardrail: enforce that the agent uses the session
 * scratchpad — both for forward-looking commitments (decisions) AND
 * backward-looking retrospective (failures/gotchas/learnings).
 *
 * Policy:
 *  - First turn of a session  → must WRITE at least one note (typically
 *    `decisions`) before ending. Forced commit-before-act.
 *  - Every turn → must have READ or WRITTEN at least one note (so the agent
 *    consulted / updated its own scratchpad).
 *  - Every turn → if this turn produced tool errors / validator warnings,
 *    the agent must write the corresponding retrospective slot
 *    (`failures` / `gotchas`). Without this, the agent reliably writes a
 *    vacuous "shipped clean. no carry-over" todo regardless of what happened.
 *  - Each distinct retrospective nudge fires at most ONCE per turn — a
 *    stubborn LLM that refuses the suggestion still gets to end the turn.
 *
 * Per-turn accumulation:
 *  An `afterIteration` hook counts tool errors and validator warnings produced
 *  this turn. `beforeTurnEnd` reads the counters to decide which retrospective
 *  slot to nudge for. Counters reset via `reset()` at run() start.
 *
 * Why this lives here, not as prompt-only nudge:
 *   Prompt nudges drift. A runtime gate that names the EXACT tool call to
 *   make survives prompt rewrites and model swaps.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';
import type { SessionNoteStore } from '../session/SessionNoteStore';

export interface SessionNoteGuardOptions {
  getStore: () => SessionNoteStore;
}

/** Count a tool result as a failure if it returned an error string. */
function isFailure(result: any): boolean {
  if (!result || typeof result !== 'object') return false;
  if (result.isError === true) return true;
  if (typeof result.error === 'string' && result.error.length > 0) return true;
  return false;
}

/** Count validator-style warnings on a successful tool result. */
function countWarnings(result: any): number {
  if (!result || typeof result !== 'object') return 0;
  const w = result.warnings;
  return Array.isArray(w) ? w.length : 0;
}

/** Does the store currently hold a non-empty value for this key? */
function hasNonEmpty(store: SessionNoteStore, key: string): boolean {
  return store.list().some(entry => entry.key === key && entry.chars > 0);
}

export function createSessionNoteGuard(opts: SessionNoteGuardOptions): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  let firstTurnWriteOccurred = false;
  let errorsThisTurn = 0;
  let warningsThisTurn = 0;
  // Track which retrospective nudge codes have already fired this turn to
  // avoid spamming the same suggestion if the model declines once.
  const nudgedThisTurn = new Set<string>();
  const presenceNudgedTurns = new Set<string>();

  const accumulator: HookRegistration = {
    id: 'builtin:sessionNoteGuard.accumulator',
    event: 'afterIteration',
    priority: 30,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      for (const { result } of ctx.iterationToolResults ?? []) {
        if (isFailure(result)) errorsThisTurn++;
        warningsThisTurn += countWarnings(result);
      }
    },
  };

  const enforcer: HookRegistration = {
    id: 'builtin:sessionNoteGuard',
    event: 'beforeTurnEnd',
    // After truncationRecovery (30) but before any general-purpose stop hooks
    // so our nudge comes out specific.
    priority: 35,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const store = opts.getStore();
      const touched = store.hasTouchedThisTurn();
      const written = store.hasWrittenThisTurn();
      const turnKey = `iter:${ctx.iteration}`;

      // ── FIRST TURN: must have written at least once. ──
      if (!firstTurnWriteOccurred) {
        if (written) {
          firstTurnWriteOccurred = true;
        } else if (!presenceNudgedTurns.has(turnKey)) {
          presenceNudgedTurns.add(turnKey);
          return {
            action: 'continue',
            code: 'SESSION_NOTE_REQUIRED',
            injectMessage:
              'Before ending this first turn, write your design decisions to the session scratchpad. '
              + 'Call: session_note({action:"write", key:"decisions", value:"<style picked, accent token, font, hero treatment, etc.>"}). '
              + 'Optionally also write key:"plan" describing the steps you took. '
              + 'After writing, you may finish the turn.',
          };
        } else {
          return; // already nudged once this turn, let it end
        }
      }

      // ── EVERY TURN: must have at least touched the scratchpad. ──
      if (firstTurnWriteOccurred && !touched && !presenceNudgedTurns.has(turnKey)) {
        presenceNudgedTurns.add(turnKey);
        return {
          action: 'continue',
          code: 'SESSION_NOTE_REQUIRED',
          injectMessage:
            'Before ending this turn, consult your session scratchpad. '
            + 'Call: session_note({action:"list"}) to see what\'s recorded, '
            + 'then read the relevant entries (decisions, todo, failures, gotchas, learnings) '
            + 'and update them if anything changed this turn.',
        };
      }

      // ── RETROSPECTIVE NUDGES (each fires at most once per turn) ──
      // If this turn produced errors and no `failures` note exists, nudge.
      if (errorsThisTurn > 0 && !hasNonEmpty(store, 'failures') && !nudgedThisTurn.has('failures')) {
        nudgedThisTurn.add('failures');
        return {
          action: 'continue',
          code: 'SESSION_NOTE_FAILURES_REQUIRED',
          injectMessage:
            `This turn had ${errorsThisTurn} tool error${errorsThisTurn === 1 ? '' : 's'}, but no \`failures\` note is recorded. `
            + 'Before ending the turn, write what failed and how you worked around it — '
            + 'so the next session can recognize the same trap. '
            + 'Call: session_note({action:"write", key:"failures", value:"<which tool / what input was rejected / how you adjusted>"}). '
            + 'Name the failure CLASS if you can (e.g. "CSS-prior bleed: model used a CSS form the DSL doesn\'t accept").',
        };
      }

      // If this turn produced validator warnings and no `gotchas` note exists, nudge.
      if (warningsThisTurn > 0 && !hasNonEmpty(store, 'gotchas') && !nudgedThisTurn.has('gotchas')) {
        nudgedThisTurn.add('gotchas');
        return {
          action: 'continue',
          code: 'SESSION_NOTE_GOTCHAS_REQUIRED',
          injectMessage:
            `This turn produced ${warningsThisTurn} validator warning${warningsThisTurn === 1 ? '' : 's'}, but no \`gotchas\` note is recorded. `
            + 'For each warning you chose NOT to fix, record what it was and why — '
            + 'so future iterations know the choice was deliberate, not overlooked. '
            + 'Call: session_note({action:"write", key:"gotchas", value:"<warning code/count / which nodes / why you left it>"}).',
        };
      }
    },
  };

  return {
    hooks: [accumulator, enforcer],
    reset: () => {
      firstTurnWriteOccurred = false;
      errorsThisTurn = 0;
      warningsThisTurn = 0;
      nudgedThisTurn.clear();
      presenceNudgedTurns.clear();
    },
  };
}
