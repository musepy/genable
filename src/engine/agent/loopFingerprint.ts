/**
 * @file loopFingerprint.ts
 * @description Builds {@link LoopFingerprint} values from raw tool calls.
 *
 * Single source of truth for "how do we identify a tool call for loop
 * detection". Zero per-tool branches — if a tool needs special signature
 * semantics, normalize its args at the call site, not here.
 *
 * Fail-fast contract:
 *   · Circular references in args → JSON.stringify throws naturally.
 *   · Unknown tool names are NOT validated here; the tool dispatcher is the
 *     authoritative gate for that.
 */

import type { ToolCallBlock } from '../llm-client/providers/types';
import type { LoopFingerprint } from './loopDetector';

export function buildLoopFingerprint(toolCalls: ToolCallBlock[]): LoopFingerprint {
  const names: string[] = [];
  const parts: string[] = [];

  for (const tc of toolCalls) {
    names.push(tc.name);
    parts.push(`${tc.name}[${stableStringify(tc.input ?? {})}]`);
  }

  return {
    toolsKey: [...names].sort().join('+'),
    signature: parts.join('|'),
  };
}

/**
 * Deterministic JSON stringify: recursively sorts object keys so that
 * `{a: 1, b: 2}` and `{b: 2, a: 1}` produce the same string.
 *
 * Arrays preserve order (order is semantically meaningful for arrays).
 * Circular references let `JSON.stringify` throw — we intentionally do
 * not catch it, so fail-fast bubbles up to the caller.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const source = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(source).sort()) {
        sorted[k] = source[k];
      }
      return sorted;
    }
    return val;
  });
}
