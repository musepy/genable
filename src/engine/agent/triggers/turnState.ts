/**
 * @file turnState.ts
 * @description Per-turn state bag for tool-plan triggers.
 *
 * Tracks ONLY:
 *  - recentToolCalls: rolling window of last N tool calls (for delete→rebuild heuristic)
 *
 * Reset on turn start (wired into builtin hooks reset()).
 *
 * Note: this used to also track `knownNodeIds`, but that was redundant with
 * the per-session InspectionTracker (see `hooks/inspectionTracker.ts`) and
 * its narrower per-turn lifetime silently nullified the tracker's cross-turn
 * memory. ID extraction now lives in `hooks/trackerFeedHook.ts`.
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
  /** Ring buffer of recent tool calls (max RECENT_TOOL_CALL_WINDOW). */
  recentToolCalls: RecentToolCall[];
  /** Observe a tool call. Pushes to recentToolCalls, trims window. */
  recordCall(tc: ToolCallBlock, parentHint?: string): void;
  /** Clear all state. Called at turn boundary. */
  reset(): void;
}

export function createTurnState(): TurnState {
  const recentToolCalls: RecentToolCall[] = [];
  let seq = 0;

  return {
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
    reset() {
      recentToolCalls.length = 0;
      seq = 0;
    },
  };
}
