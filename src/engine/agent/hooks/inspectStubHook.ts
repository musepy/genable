/**
 * @file inspectStubHook.ts
 * @description NODE_UNCHANGED stub — replaces redundant inspect/describe results.
 *
 * afterToolExec (priority 50): if inspect/describe returns identical result
 * for a node, replace with a short stub. Teaches LLM to avoid wasteful
 * re-inspects. Inspired by Claude Code's FILE_UNCHANGED_STUB.
 *
 * Also calls tracker.markInspected() on successful inspect/describe:
 *   - Direct target + every descendant in the returned tree
 *   - So later mutations on children visible in the tree aren't rejected
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';
import { InspectionTracker } from './inspectionTracker';

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

/**
 * Walk a node tree from an inspect result and mark every node as inspected.
 */
function markTreeInspected(tracker: InspectionTracker, node: any): void {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    if (typeof child?.id === 'string') {
      tracker.markInspected(child.id);
      markTreeInspected(tracker, child);
    }
  }
}

export function createInspectStubHook(tracker: InspectionTracker): {
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

      // Mark direct target
      tracker.markInspected(nodeId);

      // Mark all descendants in the result tree
      const resultData = ctx.toolResult?.data;
      if (resultData) {
        // Page root: data.children[] are top-level nodes
        // Non-page: data is the tree object itself
        if (nodeId === '/' && Array.isArray(resultData.children)) {
          for (const child of resultData.children) {
            if (typeof child?.id === 'string') {
              tracker.markInspected(child.id);
              markTreeInspected(tracker, child);
            }
          }
        } else {
          markTreeInspected(tracker, resultData);
        }
      }

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
