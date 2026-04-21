/**
 * @file turnState.ts
 * @description Per-turn state bag for tool-plan triggers.
 *
 * Tracks:
 *  - knownNodeIds: IDs observed in jsx/inspect/find_nodes results this turn
 *  - recentToolCalls: rolling window of last N tool calls (for delete→rebuild heuristic)
 *
 * Reset on turn start (wired into builtin hooks reset()).
 * Pure data container — logic lives in toolPlanTriggers.ts.
 */
import { ToolCallBlock } from '../../llm-client/providers/types';

/** Max entries to retain in the recent-calls window. Small on purpose. */
export const RECENT_TOOL_CALL_WINDOW = 5;

export interface RecentToolCall {
  /** Tool name (e.g. "delete_node", "jsx"). */
  name: string;
  /** Args passed to the tool. */
  args: any;
  /** For delete_node: target node ID. For jsx: parent (if explicit). Otherwise undefined. */
  parentHint?: string;
  /** Monotonic sequence number — useful for "within last N steps" windowing. */
  seq: number;
}

export interface TurnState {
  /** Node IDs the LLM has demonstrably seen this turn (from jsx createdIds, inspect ids, find_nodes matches). */
  knownNodeIds: Set<string>;
  /** Ring buffer of recent tool calls (max RECENT_TOOL_CALL_WINDOW). */
  recentToolCalls: RecentToolCall[];
  /** Observe a tool call. Pushes to recentToolCalls, trims window. */
  recordCall(tc: ToolCallBlock, parentHint?: string): void;
  /** Mark IDs as known (from jsx/inspect/find_nodes results). */
  addKnownIds(ids: Iterable<string>): void;
  /** Clear all state. Called at turn boundary. */
  reset(): void;
}

export function createTurnState(): TurnState {
  const knownNodeIds = new Set<string>();
  const recentToolCalls: RecentToolCall[] = [];
  let seq = 0;

  return {
    knownNodeIds,
    recentToolCalls,
    recordCall(tc: ToolCallBlock, parentHint?: string) {
      seq += 1;
      recentToolCalls.push({
        name: tc.name,
        args: tc.input,
        parentHint,
        seq,
      });
      // Trim window — drop oldest
      while (recentToolCalls.length > RECENT_TOOL_CALL_WINDOW) {
        recentToolCalls.shift();
      }
    },
    addKnownIds(ids: Iterable<string>) {
      for (const id of ids) {
        if (typeof id === 'string' && id.length > 0) {
          knownNodeIds.add(id);
        }
      }
    },
    reset() {
      knownNodeIds.clear();
      recentToolCalls.length = 0;
      seq = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Result parsers — extract node IDs from tool results
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
 *  - get_selection: data.results[].id (same shape as find_nodes)
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

  if (toolName === 'find_nodes' || toolName === 'get_selection') {
    if (Array.isArray(data.results)) {
      for (const entry of data.results) {
        if (entry && typeof entry.id === 'string') ids.push(entry.id);
      }
    }
    return ids;
  }

  // clone_node / create_instance etc: pull from idMap values if present
  if (data.idMap && typeof data.idMap === 'object') {
    for (const v of Object.values(data.idMap)) {
      if (typeof v === 'string') ids.push(v);
    }
  }
  return ids;
}
