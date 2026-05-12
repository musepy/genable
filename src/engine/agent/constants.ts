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

  /**
   * Idle timeout (ms) for an LLM stream. AgentRuntime starts an IdleAbortTimer
   * when each LLM call begins; every streamed chunk (text_delta, reasoning_delta,
   * tool-call delta) resets it. If this window elapses with no chunk, the stream
   * is treated as hung and aborted via AbortController.
   *
   * NOT a wall-clock total budget — thinking-heavy models (kimi-k2.6 etc.) can
   * legitimately stream `reasoning_content` for many minutes; that's fine as
   * long as chunks keep arriving. This is the ONLY runtime limit on a live
   * stream; per-tool timeouts were removed (orphan-frame bug).
   */
  LLM_STREAM_IDLE_TIMEOUT_MS: 300000,

  /**
   * @deprecated Renamed to `LLM_STREAM_IDLE_TIMEOUT_MS`. Semantics changed
   * from wall-clock total budget to idle-since-last-chunk. Kept here for
   * one release to avoid breaking external imports; prefer the new name.
   */
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
