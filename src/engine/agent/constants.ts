/**
 * @file constants.ts
 * @description Centralized constants for the agent engine.
 */

export const AGENT_RUNTIME_CONSTANTS = {
  /**
   * Safety-net iteration ceiling. NOT a behavioral limit.
   * The agent stops when it produces a text-only response (natural turn end).
   * This ceiling exists only to prevent runaway token spend.
   */
  DEFAULT_MAX_ITERATIONS: 200,
  
  /** Default maximum prompt tokens before triggering context compression (real LLM token count) */
  DEFAULT_MAX_CONTEXT_TOKENS: 200000,
  
  /** Maximum consecutive identical tool calls or pattern matches before loop error */
  LOOP_DETECTION_THRESHOLD: 4,  // Increased from 3 -> allow more retries for read

  /** Default timeout for a single tool execution in milliseconds */
  DEFAULT_TOOL_TIMEOUT_MS: 30000,

  /** Total budget (ms) for a single LLM generation including retries. Safety net only. */
  TOTAL_GENERATION_BUDGET_MS: 300000,

  /** @deprecated Rambling guard removed — text-only response is implicit completion. */
  MAX_THINKING_ONLY_ITERATIONS: 4,

  /** @deprecated Rambling guard removed — maxOutputTokens provides hard limit. */
  RAMBLING_TEXT_THRESHOLD: 1500,

  /** Consecutive iterations where ALL tool calls fail before injecting planning fallback */
  CONSECUTIVE_FAILURE_THRESHOLD: 3,

  /** @deprecated No longer used — text-only response is now implicit completion. */
  MAX_TEXT_ONLY_COMPLETION_RETRIES: 2,
} as const;

export const IPC_CONSTANTS = {
  /** Default timeout for IPC tool calls in milliseconds */
  DEFAULT_TIMEOUT_MS: 30000,
} as const;
