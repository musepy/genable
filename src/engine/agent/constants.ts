/**
 * @file constants.ts
 * @description Centralized constants for the agent engine.
 */

export const AGENT_RUNTIME_CONSTANTS = {
  /** Default maximum number of iterations for the agentic loop */
  DEFAULT_MAX_ITERATIONS: 40,
  
  /** Default maximum tokens before triggering context compression */
  DEFAULT_MAX_CONTEXT_TOKENS: 200000,
  
  /** Rough token estimation factor (1 token ≈ 4 characters) */
  ESTIMATION_CHARACTERS_PER_TOKEN: 4,

  /** Adjust factor for Chinese characters (approx 0.6 token per char) */
  ESTIMATION_CHINESE_CHAR_MULTIPLIER: 0.6,
  
  /** Factor of max context tokens to trigger compression (e.g., 0.7 = 70%) */
  CONTEXT_COMPRESSION_LIMIT_FACTOR: 0.7,
  
  /** Factor of max context tokens to trigger proactive compression (e.g., 0.75 = 75%) */
  CONTEXT_PROACTIVE_COMPRESSION_FACTOR: 0.75,
  
  /** Minimum number of messages to keep during context continuity */
  MIN_MESSAGES_TO_KEEP: 6,
  
  /** Minimum number of messages before redundant error cleanup is allowed */
  REDUNDANT_ERROR_DROP_THRESHOLD: 10,

  /** Maximum consecutive identical tool calls or pattern matches before loop error */
  LOOP_DETECTION_THRESHOLD: 5,

  /** Default timeout for a single tool execution in milliseconds */
  DEFAULT_TOOL_TIMEOUT_MS: 30000,

  /** Max time (ms) for thinking without action before timeout */
  THINKING_TIMEOUT_MS: 30000,

  /** Max consecutive iterations with no tool calls before error */
  MAX_THINKING_ONLY_ITERATIONS: 4,
  
  /** Minimum text length to consider as "rambling" (chars) */
  RAMBLING_TEXT_THRESHOLD: 1000,
} as const;

export const IPC_CONSTANTS = {
  /** Default timeout for IPC tool calls in milliseconds */
  DEFAULT_TIMEOUT_MS: 30000,
} as const;
