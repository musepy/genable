/**
 * @file toolPlanTriggers.ts
 * @description Tool-plan triggers — enforced at beforeToolExec / afterToolExec.
 *
 *  T5 — jsx subtree node count cap          → beforeToolExec, REJECT (skip) priority 11
 *  T_delete_rebuild — delete→jsx same parent within 3 steps → afterToolExec, hint  priority 50
 *
 * Each reject carries a concrete hint that teaches the correct alternative,
 * so the model learns to comply on the retry.
 *
 * Cap rejects carry `code: CAP_REJECT` so downstream metrics can distinguish
 * them from genuine tool failures (the LLM-facing `error` text is unchanged).
 *
 * Note: the per-turn `editUnknownId` trigger was removed — it was redundant
 * with the per-session inspectGateHook (which already covers all mutation
 * tools) and its turn-scoped reset silently nullified the tracker's
 * cross-turn ID memory. See `hooks/inspectGateHook.ts` for the surviving
 * gate and `hooks/trackerFeedHook.ts` for tracker writes.
 */
import { HookRegistration, HookContext, HookResult } from '../hooks/hookTypes';
import { TurnState } from './turnState';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const JSX_SUBTREE_NODE_CAP = Infinity;
/** Look-back window for delete→rebuild heuristic (number of tool calls). */
export const DELETE_REBUILD_WINDOW = 3;
/**
 * Machine-readable discriminator stamped on cap-reject results. Metrics
 * layers exclude this from genuine-failure counts (see `useDevBridge.ts`).
 */
export const CAP_REJECT_CODE = 'CAP_REJECT';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tag names counted as "nodes" in a jsx markup string. */
const NODE_TAG_RE = /<(frame|text|icon|vector|rect|ellipse|line|image|instance|component|group|section)\b/gi;

/** Count node-producing tags in a markup string. Simple regex — good enough for a guardrail. */
export function countJsxNodes(markup: string): number {
  if (!markup || typeof markup !== 'string') return 0;
  const matches = markup.match(NODE_TAG_RE);
  return matches ? matches.length : 0;
}

/** Extract the "parent" a jsx call will plant its subtree under. Explicit parent wins. */
function extractJsxParentHint(args: any): string | undefined {
  if (!args) return undefined;
  if (typeof args.parent === 'string' && args.parent.length > 0) return args.parent;
  return undefined;
}

/** Extract the target node of a delete_node call. */
function extractDeleteTargetId(args: any): string | undefined {
  if (args && typeof args.node === 'string') return args.node;
  return undefined;
}

// ---------------------------------------------------------------------------
// T5 — jsx subtree > N nodes → reject
// ---------------------------------------------------------------------------

export function createJsxNodeCountTrigger(): HookRegistration {
  return {
    id: 'trigger:jsxNodeCount',
    event: 'beforeToolExec',
    priority: 11,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc || tc.name !== 'jsx') return;
      const markup = tc.input?.markup;
      if (typeof markup !== 'string') return;
      const count = countJsxNodes(markup);
      if (count <= JSX_SUBTREE_NODE_CAP) return;

      return {
        action: 'skip',
        code: CAP_REJECT_CODE,
        reason:
          `jsx subtree has ${count} nodes (max ${JSX_SUBTREE_NODE_CAP}). ` +
          `Decompose: create the top-level structure, then progressively add children. ` +
          `Use subtask for independent regions (3+ distinct named areas).`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// T_delete_rebuild — delete_node followed by jsx within 3 steps, same parent → soft hint
// ---------------------------------------------------------------------------

export function createDeleteRebuildTrigger(state: TurnState): HookRegistration {
  return {
    id: 'trigger:deleteRebuild',
    event: 'afterToolExec',
    priority: 50,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc || tc.name !== 'jsx') return;
      // Only interested in successful jsx creation
      if (ctx.toolResult?.error) {
        // Still record so delete→failedJsx→jsx stays detectable later
        state.recordCall(tc, extractJsxParentHint(tc.input));
        return;
      }

      // The current jsx's parent hint: explicit parent, or the created root ID
      const currentParentHint =
        extractJsxParentHint(tc.input) ??
        (typeof ctx.toolResult?.data?.id === 'string' ? ctx.toolResult.data.id : undefined);

      // Look back at the last DELETE_REBUILD_WINDOW calls for a recent delete_node.
      // NOTE: recentToolCalls holds PAST calls — the current jsx hasn't been pushed yet.
      const recent = state.recentToolCalls.slice(-DELETE_REBUILD_WINDOW);
      const recentDelete = [...recent].reverse().find(c => c.name === 'delete_node');

      let shouldHint = false;
      if (recentDelete) {
        const deletedId = recentDelete.parentHint; // we recorded target in parentHint
        // Parent-sharing approximation:
        //  a) explicit: current jsx's parent === deleted node's ID (nesting into ex-parent)
        //  b) prefix: deleted ID shares file prefix with new root ID (same file → likely same vicinity)
        //  c) fallback: any delete→jsx within window is suspicious enough to warrant the hint
        if (deletedId && currentParentHint && deletedId === currentParentHint) {
          shouldHint = true;
        } else if (deletedId && currentParentHint) {
          const [deletedPrefix] = deletedId.split(':');
          const [currentPrefix] = currentParentHint.split(':');
          if (deletedPrefix && deletedPrefix === currentPrefix) shouldHint = true;
        } else {
          // No parent info on either side — still hint (fallback)
          shouldHint = true;
        }
      }

      // Record AFTER look-back so the current jsx doesn't shadow itself
      state.recordCall(tc, currentParentHint);

      if (!shouldHint) return;

      return {
        action: 'continue',
        injectMessage:
          `You just deleted a subtree and recreated one. ` +
          `If the goal is to restructure, prefer move_node (reorder), replace_props (change variant), ` +
          `or edit (change properties) over delete+rebuild — these preserve IDs and save tokens.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Delete-call observer — record delete_node into recentToolCalls so the
// delete-rebuild trigger has a look-back window.
// ---------------------------------------------------------------------------

/**
 * afterToolExec observer (priority 5) — records delete_node calls into
 * the turn's recent-calls window. That's all it does; tracker writes are
 * handled by trackerFeedHook (priority 4).
 */
export function createDeleteCallObserver(state: TurnState): HookRegistration {
  return {
    id: 'trigger:deleteCallObserver',
    event: 'afterToolExec',
    priority: 5,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc || tc.name !== 'delete_node') return;
      state.recordCall(tc, extractDeleteTargetId(tc.input));
    },
  };
}

// ---------------------------------------------------------------------------
// Factory — bundle all tool-plan triggers with shared state
// ---------------------------------------------------------------------------

export interface ToolPlanTriggersBundle {
  hooks: HookRegistration[];
  state: TurnState;
  reset: () => void;
}

/**
 * Create the tool-plan triggers bundle with shared turn state.
 * Caller wires `hooks` into HookRegistry and `reset` into turn-start.
 */
export function createToolPlanTriggers(state: TurnState): {
  hooks: HookRegistration[];
} {
  return {
    hooks: [
      createJsxNodeCountTrigger(),
      createDeleteCallObserver(state),
      createDeleteRebuildTrigger(state),
    ],
  };
}
