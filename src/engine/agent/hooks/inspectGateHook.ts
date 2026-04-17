/**
 * @file inspectGateHook.ts
 * @description Reality-check gate: rejects mutations on unknown (hallucinated) node IDs.
 *
 * Two hooks cooperate:
 *   - beforeToolExec (priority 15): rejects mutations on nodes never seen this turn
 *   - afterToolExec  (priority 20): consumes inspection (dirty flag) after successful mutation
 *
 * Gate logic: if the target ID has not appeared in any inspect/describe/jsx
 * result (not in tracker), reject — this is the main protection against
 * the LLM hallucinating node IDs. No property-vs-structural distinction:
 * Figma has no dirty-read hazards, so "must re-read before edit" created
 * more round-trip cost than safety value.
 *
 * Creation tools (jsx, create_instance, create_component, create_variable)
 * are exempt — they produce new nodes.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';
import { InspectionTracker } from './inspectionTracker';
import { ToolDefinition } from '../tools/types';

/** Tools that create rather than target existing nodes — exempt from gate. */
const CREATION_TOOLS = new Set(['jsx', 'create_instance', 'create_component', 'create_variable']);

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

  // combine_components takes nodes[] as an array of IDs
  if (toolName === 'combine_components' && Array.isArray(args.nodes)) {
    return args.nodes.filter((id: any): id is string => typeof id === 'string');
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

      const nodeIds = extractTargetNodeIds(tc.name, tc.input);
      if (nodeIds.length === 0) return;

      const unknownIds = nodeIds.filter(id => !tracker.isInspected(id));
      if (unknownIds.length === 0) return;

      const hint = unknownIds.length === 1
        ? `inspect({node: "${unknownIds[0]}"})`
        : unknownIds.map(id => `inspect({node: "${id}"})`).join(', ');

      return {
        action: 'skip',
        reason:
          `Node ${unknownIds.join(', ')} unknown — it hasn't appeared in any inspect/describe/jsx result this turn. ` +
          `Inspect it or create it before modifying. Call ${hint}.`,
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

      const nodeIds = extractTargetNodeIds(tc.name, tc.input);
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
