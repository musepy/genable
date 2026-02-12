/**
 * @file constants.ts
 * @description Centralized constants for the agent engine.
 */

export const AGENT_RUNTIME_CONSTANTS = {
  /** Default maximum number of iterations for the agentic loop */
  DEFAULT_MAX_ITERATIONS: 40,
  
  /** Default maximum tokens before triggering context compression */
  DEFAULT_MAX_CONTEXT_TOKENS: 200000,
  
  /** Factor of max context tokens to trigger compression (e.g., 0.7 = 70%) */
  // CONTEXT_COMPRESSION_LIMIT_FACTOR moved to context/constants.ts
  
  /** Factor of max context tokens to trigger proactive compression (e.g., 0.75 = 75%) */
  // CONTEXT_PROACTIVE_COMPRESSION_FACTOR moved to context/constants.ts
  
  /** Minimum number of messages before redundant error cleanup is allowed */
  // REDUNDANT_ERROR_DROP_THRESHOLD moved to context/constants.ts

  /** Maximum consecutive identical tool calls or pattern matches before loop error */
  LOOP_DETECTION_THRESHOLD: 4,  // Increased from 3 -> allow more retries for inspectDesign

  /** Default timeout for a single tool execution in milliseconds */
  DEFAULT_TOOL_TIMEOUT_MS: 30000,

  /** Max time (ms) for thinking without action before timeout */
  THINKING_TIMEOUT_MS: 60000,

  /** Max consecutive iterations with no tool calls before error */
  MAX_THINKING_ONLY_ITERATIONS: 4,
  
  /** Minimum text length to consider as "rambling" (chars). Gemini streams text before tool calls, so this must be high enough to not abort before tool calls arrive. */
  RAMBLING_TEXT_THRESHOLD: 1500,

  /** Maximum chars for batch operation results including idMap + results (~2500 tokens) */
  // TOOL_RESULT_BATCH_BUDGET moved to context/constants.ts

  /** Consecutive iterations where ALL tool calls fail before injecting planning fallback */
  CONSECUTIVE_FAILURE_THRESHOLD: 3,
} as const;

export const IPC_CONSTANTS = {
  /** Default timeout for IPC tool calls in milliseconds */
  DEFAULT_TIMEOUT_MS: 30000,
} as const;
