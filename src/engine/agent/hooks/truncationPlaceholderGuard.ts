/**
 * @file truncationPlaceholderGuard.ts
 * @description beforeToolExec guard — rejects tool calls whose arguments contain
 * literal truncation placeholders (e.g. a `props` field serialized as the string
 * `"{…}"` instead of the actual object).
 *
 * Failure mode this catches:
 *   Model is asked to edit many nodes in one call. Mid-generation it emits
 *   shorthand placeholders like `"props": "{…}"` instead of the full object —
 *   either as learned compression behavior (Kimi) or as the surviving fragment
 *   of a response that was server-truncated at max_tokens. The JSON parses
 *   cleanly, so the call reaches dispatch with a string where an object was
 *   expected. Executor then errors with something unrelated ("No props or
 *   content"), which the LLM misreads as its own mistake and retries the
 *   same too-large batch, looping.
 *
 * Why detect here (beforeToolExec) and not at provider parse:
 *   - finishReason is not always reliable: Kimi self-truncates even when the
 *     provider reports finish_reason='stop' or 'tool_calls'.
 *   - JSON parse succeeds — the call only looks wrong in schema terms, and
 *     we have no per-tool Zod validation on the dispatch path today.
 *   - Returning a synthetic tool result with the correct diagnosis names
 *     the real cause and teaches the LLM to reduce batch size next iteration.
 *
 * Scope intentionally narrow: matches only the structural placeholders
 * `{…}`, `{...}`, `[…]`, `[...]` (trimmed). Bare `...` and `…` are excluded
 * to avoid false positives on legitimate UI text like a loading indicator.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';
import { ToolCallBlock } from '../../llm-client/providers/types';

/**
 * Unambiguous truncation placeholders. Each is checked after `.trim()` on a
 * string leaf — a full match means that leaf is a placeholder, not real data.
 */
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  '{…}',    // U+2026 ellipsis inside braces
  '{...}',  // three-ASCII-dots inside braces
  '[…]',    // U+2026 ellipsis inside brackets
  '[...]',  // three-ASCII-dots inside brackets
]);

interface Found {
  path: string;
  value: string;
}

function findPlaceholder(value: unknown, path = ''): Found | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (PLACEHOLDERS.has(trimmed)) return { path: path || '<root>', value: trimmed };
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findPlaceholder(value[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const r = findPlaceholder((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      if (r) return r;
    }
  }
  return null;
}

/** Exported for unit tests. */
export const __test__ = { findPlaceholder };

export function createTruncationPlaceholderGuard(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  const hook: HookRegistration = {
    id: 'builtin:truncationPlaceholderGuard',
    event: 'beforeToolExec',
    // run after emptyArgsSkip (priority 10) so empty-args gets its own message first
    priority: 15,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc: ToolCallBlock | undefined = ctx.currentToolCall;
      if (!tc?.input) return;

      const found = findPlaceholder(tc.input);
      if (!found) return;

      return {
        action: 'skip',
        code: 'TRUNCATION_PLACEHOLDER',
        reason:
          `Tool call "${tc.name}" contains a truncation placeholder "${found.value}" ` +
          `at input.${found.path}. This means your previous response was cut off ` +
          `before you finished writing the full arguments. Retry with a smaller batch: ` +
          `e.g. edit at most 4 nodes per call, or inspect first then edit in batches.`,
      };
    },
  };

  return {
    hooks: [hook],
    reset: () => {},
  };
}
