/**
 * @file contextCompression.ts
 * @description Pure functions for context compression. Operate directly on
 * LLMMessage[] arrays, mutating `hidden` flags in place.
 *
 * Replaces the old ContextManager class with composable, testable functions.
 */

import { LLMMessage } from '../../llm-client/providers/types';
import { CONTEXT_CONSTANTS } from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Turn {
  id: string;
  indices: number[];
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Hide tool-error messages whose tool was later called successfully,
 * provided the visible message count exceeds the threshold.
 */
export function dropRedundantToolErrors(messages: LLMMessage[]): void {
  const visibleCount = messages.filter(m => !m.hidden).length;
  const successfulTools = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.hidden || msg.role !== 'tool' || !Array.isArray(msg.content)) continue;

    const results = msg.content as any[];
    const isSuccess = results.every(r => r.functionResponse?.response?.success !== false);
    if (isSuccess) {
      results.forEach(r => successfulTools.add(r.functionResponse?.name));
    } else {
      const allFixed = results.every(r => successfulTools.has(r.functionResponse?.name));
      if (allFixed && visibleCount > CONTEXT_CONSTANTS.REDUNDANT_ERROR_DROP_THRESHOLD) {
        msg.hidden = true;
      }
    }
  }
}

/**
 * Hide the oldest turns when `excessTokens > 0`.
 *
 * Unlike the old ContextManager, this does NOT estimate per-message token
 * sizes. It simply hides one turn at a time. The caller re-checks
 * `lastPromptTokens` after the next LLM call and hides more if needed.
 *
 * @param turnsToHide - Number of oldest (non-pinned) turns to hide.
 *                      Defaults to 1.  Pass a higher number when the
 *                      overshoot is large.
 */
export function truncateByTurns(
  messages: LLMMessage[],
  turnsToHide: number = 1,
): void {
  const minTurnsToKeep = CONTEXT_CONSTANTS.MIN_TURNS_TO_KEEP;
  const turns = groupIntoTurns(messages);

  if (turns.length <= minTurnsToKeep) return;

  const maxHideable = turns.length - minTurnsToKeep;
  const toHide = Math.min(turnsToHide, maxHideable);
  let hiddenCount = 0;

  for (let i = 0; i < toHide; i++) {
    const turn = turns[i];
    for (const idx of turn.indices) {
      if (messages[idx].pinned) continue;
      messages[idx].hidden = true;
      hiddenCount++;
    }
  }

  if (hiddenCount > 0) {
    console.log(`[contextCompression] Truncated ${hiddenCount} messages (${toHide} turns).`);
  }
}

/**
 * Fix invalid message sequences after truncation:
 * 1. Ensure visible model messages with function calls have matching tool responses.
 * 2. Ensure the first visible non-system message is a user message.
 */
export function fixInvalidSequence(messages: LLMMessage[]): void {
  let fixed = false;

  // Strategy 1: Ensure tool responses are visible for visible model calls
  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    if (msg.hidden || msg.role !== 'model' || !hasFunctionCalls(msg)) continue;

    let hasToolResponse = false;
    for (let j = msgIdx + 1; j < messages.length; j++) {
      if (messages[j].role === 'system') continue;
      if (messages[j].hidden && messages[j].role === 'tool') {
        messages[j].hidden = false;
        hasToolResponse = true;
        fixed = true;
      } else if (!messages[j].hidden && messages[j].role === 'tool') {
        hasToolResponse = true;
      }
      if (messages[j].role !== 'tool' && messages[j].role !== 'system') break;
    }

    if (!hasToolResponse) {
      msg.hidden = true;
      fixed = true;
    }
  }

  // Strategy 2: Ensure sequence starts with user message after system
  const firstVisibleIdx = messages.findIndex(m => !m.hidden && m.role !== 'system');
  if (firstVisibleIdx !== -1 && messages[firstVisibleIdx].role !== 'user') {
    for (let i = firstVisibleIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'system') continue;
      messages[i].hidden = false;
      fixed = true;
      if (messages[i].role === 'user') break;
    }
  }

  if (fixed) {
    console.log('[contextCompression] Fixed invalid message sequence after truncation.');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group visible, non-system messages into turns.
 * A turn starts with a non-summary `user` message.
 */
export function groupIntoTurns(messages: LLMMessage[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.hidden || msg.role === 'system') continue;

    if (msg.role === 'user' && !msg.summaryOf) {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = { id: msg.id, indices: [i] };
    } else if (currentTurn) {
      currentTurn.indices.push(i);
    }
  }

  if (currentTurn) turns.push(currentTurn);
  return turns;
}

/**
 * Validate that visible messages follow the expected role sequence.
 */
export function validateMessageSequence(messages: LLMMessage[]): { valid: boolean; error?: string } {
  const visible = messages.filter(m => !m.hidden);
  if (visible.length === 0) return { valid: true };

  let lastRole: string | null = null;
  for (let i = 0; i < visible.length; i++) {
    const m = visible[i];
    if (m.role === 'system') {
      if (i !== 0) return { valid: false, error: 'System message must be first' };
      continue;
    }

    if (lastRole === 'model') {
      if (m.role !== 'tool' && m.role !== 'user') return { valid: false, error: 'Model message must be followed by tool or user' };
    } else if (lastRole === 'tool') {
      if (m.role !== 'tool' && m.role !== 'model') return { valid: false, error: 'Tool message must be followed by tool or model' };
    } else if (lastRole === 'user') {
      if (m.role !== 'model') return { valid: false, error: 'User message must be followed by model' };
    } else if (lastRole === null) {
      if (m.role !== 'user') return { valid: false, error: 'First non-system message must be user' };
    }
    lastRole = m.role;
  }
  return { valid: true };
}

function hasFunctionCalls(msg: LLMMessage): boolean {
  if (msg.role !== 'model') return false;
  if (Array.isArray(msg.content)) {
    return msg.content.some((p: any) => p.functionCall);
  }
  return false;
}
