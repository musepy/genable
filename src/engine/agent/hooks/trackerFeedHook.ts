/**
 * @file trackerFeedHook.ts
 * @description Single source of truth that feeds InspectionTracker from tool results.
 *
 * Consolidates tracker.markInspected() writes into ONE afterToolExec hook
 * driven by extractKnownIdsFromResult — which already understands every
 * tool shape that produces visible node IDs (jsx, inspect, describe,
 * find_nodes, get_selection, clone_node, create_instance, create_component,
 * combine_components, etc.).
 *
 * Why one hook: the previous design sprinkled markInspected calls across
 * agentRuntime, inspectStubHook, and the tool-plan observer. Every new
 * tool that surfaces an ID had to remember to update three places. This
 * hook makes "if a successful tool result mentions an ID, the tracker
 * sees it" a property of the runtime, not of each tool's wiring.
 *
 * Priority 4 — runs BEFORE the delete-call observer (priority 5) and well
 * before inspectGate's afterToolExec dirty hook (priority 20). On error
 * results we skip, so partial successes never leak into the tracker.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';
import { InspectionTracker } from './inspectionTracker';

// ---------------------------------------------------------------------------
// Result parsers — extract node IDs from tool results
// (moved from triggers/turnState.ts; see history for prior location)
// ---------------------------------------------------------------------------

/**
 * Recursively walk an inspect tree result and collect all node IDs.
 * Tree shape: { id, children: [...] } with nested children arrays.
 */
export function collectIdsFromInspectTree(data: any, acc: Set<string> = new Set()): Set<string> {
  if (!data || typeof data !== 'object') return acc;

  // Tree node with id
  if (typeof data.id === 'string') acc.add(data.id);

  // Walk children array
  if (Array.isArray(data.children)) {
    for (const child of data.children) {
      collectIdsFromInspectTree(child, acc);
    }
  }
  return acc;
}

/**
 * Extract known IDs from a successful tool result based on tool name.
 *  - jsx: data.id + data.createdIds[]
 *  - inspect/describe: recurse data tree for all id fields
 *  - find_nodes: data.results[].id
 *  - get_selection: data.selection[].id
 *  - clone/instance/component/combine: data.idMap values + createdIds + nodeId
 *  - others: no-op
 */
export function extractKnownIdsFromResult(toolName: string, rawResult: any): string[] {
  if (!rawResult || rawResult.error) return [];
  const data = rawResult.data;
  if (!data) return [];

  const ids: string[] = [];

  if (toolName === 'jsx') {
    if (typeof data.id === 'string') ids.push(data.id);
    if (Array.isArray(data.createdIds)) {
      for (const id of data.createdIds) if (typeof id === 'string') ids.push(id);
    }
    return ids;
  }

  if (toolName === 'inspect' || toolName === 'describe') {
    const s = new Set<string>();
    collectIdsFromInspectTree(data, s);
    return Array.from(s);
  }

  if (toolName === 'find_nodes') {
    if (Array.isArray(data.results)) {
      for (const entry of data.results) {
        if (entry && typeof entry.id === 'string') ids.push(entry.id);
      }
    }
    return ids;
  }

  if (toolName === 'get_selection') {
    if (Array.isArray(data.selection)) {
      for (const entry of data.selection) {
        if (entry && typeof entry.id === 'string') ids.push(entry.id);
      }
    }
    return ids;
  }

  // clone_node / create_instance / create_component / combine_components etc:
  // pull from idMap values, createdIds, and nodeId. idMap is alias→rootId only;
  // createdIds lists all newly-materialised node IDs (including descendants);
  // nodeId is used by component handlers that return a single new node.
  if (data.idMap && typeof data.idMap === 'object') {
    for (const v of Object.values(data.idMap)) {
      if (typeof v === 'string') ids.push(v);
    }
  }
  if (Array.isArray(data.createdIds)) {
    for (const id of data.createdIds) if (typeof id === 'string') ids.push(id);
  }
  if (typeof data.nodeId === 'string') ids.push(data.nodeId);
  return ids;
}

// ---------------------------------------------------------------------------
// Hook factory
// ---------------------------------------------------------------------------

export function createTrackerFeedHook(tracker: InspectionTracker): {
  hooks: HookRegistration[];
} {
  const feedHook: HookRegistration = {
    id: 'builtin:trackerFeed',
    event: 'afterToolExec',
    priority: 4, // before deleteCallObserver (5) and inspectGate dirty hook (20)
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const tc = ctx.currentToolCall;
      if (!tc) return;
      // Skip on error — partial/failed results must not pollute the tracker
      if (!ctx.toolResult || ctx.toolResult.error) return;

      const ids = extractKnownIdsFromResult(tc.name, ctx.toolResult);
      for (const id of ids) tracker.markInspected(id);
    },
  };

  return { hooks: [feedHook] };
}
