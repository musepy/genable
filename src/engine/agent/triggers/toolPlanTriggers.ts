/**
 * @file toolPlanTriggers.ts
 * @description Hard caps on the agent's tool-plan — enforced at beforeToolExec / afterToolExec.
 *
 * Historical measurement (6 qwen3.6-plus runs, pre-experiment):
 *  - 65% of jsx calls exceed 1500 chars (28 of 43)
 *  - 28% of jsx calls exceed 60 nodes (12 of 43)
 *  - P2-Fitness retried a 7K-char broken jsx 7 times before giving up
 *  - 9 delete→rebuild cycles across 6 runs (each wastes ~2-4K output tokens)
 *
 * Experiment (April 2026): jsx char cap relaxed from 1500 → 10000 to observe
 * whether node-count cap (T5, 60 nodes) is a sufficient primary guardrail.
 * The 10K char cap remains as a safety net for pathological markup (e.g. a
 * 50K byte blob that would otherwise burn tokens before node-count rejects).
 *
 * The runtime enforces:
 *
 *  T4 — jsx markup > 10000 chars           → beforeToolExec, REJECT (skip) priority 10
 *  T5 — jsx subtree > 60 nodes             → beforeToolExec, REJECT (skip) priority 11
 *  T6 — edit targets unknown node ID       → beforeToolExec, REJECT (skip) priority 12
 *  T_delete_rebuild — delete→jsx same parent within 3 steps → afterToolExec, hint  priority 50
 *
 * Each reject carries a concrete hint that teaches the correct alternative,
 * so the model learns to comply on the retry.
 *
 * Cap rejects carry `code: CAP_REJECT` so downstream metrics can distinguish
 * them from genuine tool failures (the LLM-facing `error` text is unchanged).
 */
import { HookRegistration, HookContext, HookResult } from '../hooks/hookTypes';
import { TurnState, extractKnownIdsFromResult } from './turnState';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const JSX_MARKUP_CHAR_CAP = 10000;
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

/** Extract edit-target node IDs from args, supporting both single + batch modes. */
function extractEditTargetIds(args: any): string[] {
  if (!args) return [];
  const ids: string[] = [];
  if (Array.isArray(args.nodes)) {
    for (const entry of args.nodes) {
      if (entry && typeof entry.node === 'string') ids.push(entry.node);
    }
  }
  if (typeof args.node === 'string') ids.push(args.node);
  return ids;
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
// T4 — jsx markup > 1500 chars → reject
// ---------------------------------------------------------------------------

export function createJsxMarkupSizeTrigger(): HookRegistration {
  return {
    id: 'trigger:jsxMarkupSize',
    event: 'beforeToolExec',
    priority: 10,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc || tc.name !== 'jsx') return;
      const markup = tc.input?.markup;
      if (typeof markup !== 'string') return;
      const len = markup.length;
      if (len <= JSX_MARKUP_CHAR_CAP) return;

      return {
        action: 'skip',
        code: CAP_REJECT_CODE,
        reason:
          `jsx markup is ${len} chars (max ${JSX_MARKUP_CHAR_CAP}). ` +
          `Split across calls: (1) first jsx creates the root frame — save the returned id; ` +
          `(2) each follow-up jsx MUST pass parent: "<that id>" (or a descendant id) to nest directly, ` +
          `plus index when sibling order matters. ` +
          `Do NOT recreate pieces at page root and move_node them later — that duplicates work and wastes tokens.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// T5 — jsx subtree > 60 nodes → reject
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
// T6 — edit targets node ID not in session's idMap → reject
// ---------------------------------------------------------------------------

export function createEditUnknownIdTrigger(state: TurnState): HookRegistration {
  return {
    id: 'trigger:editUnknownId',
    event: 'beforeToolExec',
    priority: 12, // MUST run before inspectGateHook at 15
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc || tc.name !== 'edit') return;

      const ids = extractEditTargetIds(tc.input);
      if (ids.length === 0) return;

      // Page root "/" is always known — exempt
      const unknown = ids.filter(id => id !== '/' && !state.knownNodeIds.has(id));
      if (unknown.length === 0) return;

      // Single-ID message reads more naturally than joined list when count=1
      const displayId = unknown.length === 1 ? unknown[0] : unknown.join(', ');
      return {
        action: 'skip',
        code: CAP_REJECT_CODE,
        reason:
          `Node '${displayId}' not found in this session. ` +
          `Call find_nodes({query: ...}) or get_selection() to locate it first.`,
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

      // Record created IDs as known so follow-up edits pass T6
      const createdIds = extractKnownIdsFromResult('jsx', ctx.toolResult);
      state.addKnownIds(createdIds);

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
// Result observer — track known IDs from successful reads (inspect, find_nodes, etc.)
// ---------------------------------------------------------------------------

/**
 * afterToolExec observer (priority 5 — runs before other afterToolExec hooks)
 * for non-jsx tools that reveal node IDs to the LLM. jsx is handled by the
 * delete-rebuild trigger so it can also emit the hint.
 *
 * Also records delete_node for the delete-rebuild window.
 */
export function createKnownIdObserver(state: TurnState): HookRegistration {
  return {
    id: 'trigger:knownIdObserver',
    event: 'afterToolExec',
    priority: 5,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc) return;

      // Record delete_node into the recent-calls window (parentHint = deleted target)
      if (tc.name === 'delete_node') {
        state.recordCall(tc, extractDeleteTargetId(tc.input));
        return;
      }

      // Don't re-record jsx here — the delete-rebuild trigger handles it.
      if (tc.name === 'jsx') return;

      // Harvest IDs from read-oriented tool results
      if (!ctx.toolResult || ctx.toolResult.error) return;
      const ids = extractKnownIdsFromResult(tc.name, ctx.toolResult);
      if (ids.length > 0) state.addKnownIds(ids);
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
      createJsxMarkupSizeTrigger(),
      createJsxNodeCountTrigger(),
      createEditUnknownIdTrigger(state),
      createKnownIdObserver(state),
      createDeleteRebuildTrigger(state),
    ],
  };
}
