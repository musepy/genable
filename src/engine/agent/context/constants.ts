/**
 * @file constants.ts
 * @description Centralized constants for context management.
 */

export const CONTEXT_CONSTANTS = {
  /** Factor of max context chars to trigger compression (e.g., 0.8 = 80%) */
  CONTEXT_COMPRESSION_LIMIT_FACTOR: 0.8,

  /** Factor of max context tokens to trigger proactive compression (e.g., 0.85 = 85%) */
  CONTEXT_PROACTIVE_COMPRESSION_FACTOR: 0.85,

  /** Minimum number of messages to keep during context continuity */
  MIN_MESSAGES_TO_KEEP: 10,

  /** Minimum number of TURNS to keep during turn-based truncation */
  MIN_TURNS_TO_KEEP: 3,

  /** Minimum number of messages before redundant error cleanup is allowed */
  REDUNDANT_ERROR_DROP_THRESHOLD: 10,

  /** Maximum chars for standard tool result data before truncation (~750 tokens) */
  TOOL_RESULT_MAX_DATA_CHARS: 3000,

  /** Maximum chars for build_design results including idMap + lineResults (~1250 tokens) */
  TOOL_RESULT_BATCH_BUDGET: 5000,

  /**
   * Max chars for a single tool call's args when stored in history.
   * ~375 tokens. Prevents large build_design operations from bloating context.
   */
  MAX_HISTORY_ARGS_CHARS: 1500,
} as const;
