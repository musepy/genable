/**
 * @file constants.ts
 * @description Centralized constants for context management.
 */

export const CONTEXT_CONSTANTS = {
  /** Maximum chars for standard tool result data before truncation (~750 tokens) */
  TOOL_RESULT_MAX_DATA_CHARS: 3000,

  /** Char threshold for auto-degrading read full → structural + hint */
  READ_AUTO_DEGRADE_CHARS: 2500,

  /**
   * Max chars for a single tool call's args when stored in history.
   * ~375 tokens. Prevents large build_design operations from bloating context.
   */
  MAX_HISTORY_ARGS_CHARS: 1500,
} as const;
