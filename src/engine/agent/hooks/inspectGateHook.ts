/**
 * @file inspectGateHook.ts
 * @description Mechanical gate: mutation tools require prior inspect on target node.
 *
 * Two hooks cooperate:
 *   - beforeToolExec (priority 15): rejects mutations on uninspected nodes
 *   - afterToolExec  (priority 20): consumes inspection (dirty flag) after successful mutation
 *
 * Inspired by Claude Code's "Read before Edit" tool contract.
 * jsx is exempt — it creates nodes, doesn't target existing ones.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';
import { InspectionTracker } from './inspectionTracker';
import { ToolDefinition } from '../tools/types';

/** Tools that create rather than target existing nodes — exempt from gate. */
const CREATION_TOOLS = new Set(['jsx']);

/** Tools with batch node arrays: args.nodes[].node */
const BATCH_TOOLS = new Set(['edit', 'set_text']);

/**
 * Extract target node IDs from a tool call's arguments.
 * Returns empty array for creation tools or tools without node targeting.
 */
function extractTargetNodeIds(toolName: string, args: any): string[] {
  if (!args) return [];

  // Batch mode: edit({nodes: [{node: "1:2", ...}]}) / set_text({nodes: [{node, text}]})
  if (BATCH_TOOLS.has(toolName) && Array.isArray(args.nodes)) {
    return args.nodes
      .map((entry: any) => entry?.node)
      .filter((id: any): id is string => typeof id === 'string');
  }

  // Single mode: edit({node: "1:2", ...}) or set_fill({node: "1:2", ...})
  if (typeof args.node === 'string') {
    return [args.node];
  }

  return [];
}

export function createInspectGateHook(
  tracker: InspectionTracker,
  toolDefs: ToolDefinition[],
): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  // Build O(1) lookup for mutation tools (mutates: true, minus creation tools)
  const mutationTools = new Set<string>();
  for (const def of toolDefs) {
    if (def.mutates && !CREATION_TOOLS.has(def.name)) {
      mutationTools.add(def.name);
    }
  }

  // ── beforeToolExec: gate ──
  const gateHook: HookRegistration = {
    id: 'builtin:inspectGate',
    event: 'beforeToolExec',
    priority: 15,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc || !mutationTools.has(tc.name)) return;

      const nodeIds = extractTargetNodeIds(tc.name, tc.args);
      if (nodeIds.length === 0) return;

      const uninspected = nodeIds.filter(id => !tracker.isInspected(id));
      if (uninspected.length === 0) return;

      const hint = uninspected.length === 1
        ? `inspect({node: "${uninspected[0]}"})`
        : uninspected.map(id => `inspect({node: "${id}"})`).join(', ');

      return {
        action: 'skip',
        reason: `Node ${uninspected.join(', ')} not inspected. Call ${hint} first to confirm current state before modifying.`,
      };
    },
  };

  // ── afterToolExec: dirty flag ──
  const dirtyHook: HookRegistration = {
    id: 'builtin:inspectGate:dirty',
    event: 'afterToolExec',
    priority: 20,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc || !mutationTools.has(tc.name)) return;

      // Only consume on success (no error in result)
      if (ctx.toolResult?.error) return;

      const nodeIds = extractTargetNodeIds(tc.name, tc.args);
      for (const id of nodeIds) {
        tracker.consumeInspection(id);
      }
    },
  };

  return {
    hooks: [gateHook, dirtyHook],
    reset: () => {}, // No internal state — tracker owns the Set
  };
}
