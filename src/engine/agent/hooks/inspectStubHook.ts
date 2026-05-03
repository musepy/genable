/**
 * @file inspectStubHook.ts
 * @description NODE_UNCHANGED stub — replaces redundant inspect/describe results.
 *
 * afterToolExec (priority 50): if inspect/describe returns identical result
 * for a node, replace with a short stub. Teaches LLM to avoid wasteful
 * re-inspects. Inspired by Claude Code's FILE_UNCHANGED_STUB.
 *
 * Tracker writes for inspect/describe results (root + descendants) are
 * handled centrally by `trackerFeedHook` — this hook only owns the
 * stub-replacement cache.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';

/** Tools that count as "reading" a node. */
const READ_TOOLS = new Set(['inspect', 'describe']);

/**
 * Simple string hash for comparing tool results.
 * Not cryptographic — just needs collision resistance for diffing.
 */
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

export function createInspectStubHook(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  // Cache: nodeId → hash of last successful result
  const resultCache = new Map<string, string>();

  const stubHook: HookRegistration = {
    id: 'builtin:inspectStub',
    event: 'afterToolExec',
    priority: 50,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc || !READ_TOOLS.has(tc.name)) return;

      // Don't stub errors
      if (ctx.toolResult?.error) return;

      const nodeId = tc.input?.node;
      if (!nodeId || typeof nodeId !== 'string') return;

      const resultData = ctx.toolResult?.data;

      // Hash the result for comparison
      const hash = simpleHash(JSON.stringify(resultData ?? ctx.toolResult));
      const cached = resultCache.get(nodeId);

      if (cached === hash) {
        // Unchanged — replace with stub
        return {
          action: 'continue',
          modifiedResult: {
            data: {
              _stub: true,
              message: `Node ${nodeId} unchanged since last ${tc.name}. Refer to previous result.`,
            },
          },
        };
      }

      // New or changed — cache and pass through
      resultCache.set(nodeId, hash);
    },
  };

  return {
    hooks: [stubHook],
    reset: () => { resultCache.clear(); },
  };
}
