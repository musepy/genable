/**
 * @file retryPolicy.ts
 * @description Error classification and retry strategies for the Agent Engine.
 * 
 * This is a **pure classifier** — it categorizes errors and provides strategy
 * configurations. Retry state management (attempt counting, backoff timing)
 * is handled by `retry/retryWithBackoff.ts`.
 */

import { GeminiErrorType } from '../llm-client/providers/gemini/geminiErrorHandler';
import { isNetworkError, isFetchError } from './retry/networkErrors';

// ---------------------------------------------------------------------------
// Error Categories
// ---------------------------------------------------------------------------

export enum AgentErrorCategory {
  /** Transient server errors: 503, 5xx, timeout */
  RETRYABLE_TRANSIENT = 'RETRYABLE_TRANSIENT',
  /** LLM output format issues: malformed tool call, empty response */
  RETRYABLE_MALFORMED = 'RETRYABLE_MALFORMED',
  /** Temporary rate limit: 429, "temporarily rate-limited" — wait and retry */
  RETRYABLE_RATE_LIMIT = 'RETRYABLE_RATE_LIMIT',
  /** Network connectivity: ECONNRESET, ETIMEDOUT, fetch failed */
  RETRYABLE_NETWORK = 'RETRYABLE_NETWORK',
  /** Quota/billing exhausted: user must top up or change key — no retry */
  NON_RETRYABLE_QUOTA = 'NON_RETRYABLE_QUOTA',
  /** Invalid input: 400, context too large, token overflow */
  NON_RETRYABLE_INPUT = 'NON_RETRYABLE_INPUT',
  /** Logic errors: missing executor, code bugs */
  NON_RETRYABLE_LOGIC = 'NON_RETRYABLE_LOGIC',
  /** Tool execution errors */
  LOCAL_TOOL_ERROR = 'LOCAL_TOOL_ERROR',
}

// ---------------------------------------------------------------------------
// Retry Strategy Configuration (used by consumers to pick RetryOptions)
// ---------------------------------------------------------------------------

export interface RetryStrategy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

export const RETRY_STRATEGIES: Record<string, RetryStrategy> = {
  /** For transient server errors: moderate retries with standard backoff */
  [AgentErrorCategory.RETRYABLE_TRANSIENT]: {
    maxAttempts: 4,
    initialDelayMs: 2000,
    maxDelayMs: 15000,
    backoffMultiplier: 2,
    jitterFactor: 0.3,
  },
  /** For malformed output: quick retries, less aggressive backoff */
  [AgentErrorCategory.RETRYABLE_MALFORMED]: {
    maxAttempts: 3,
    initialDelayMs: 500,
    maxDelayMs: 3000,
    backoffMultiplier: 1.5,
    jitterFactor: 0.2,
  },
  /** For rate limit errors: longer waits to respect rate limits */
  [AgentErrorCategory.RETRYABLE_RATE_LIMIT]: {
    maxAttempts: 5,
    initialDelayMs: 5000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterFactor: 0.2,
  },
  /** For network errors: moderate retries */
  [AgentErrorCategory.RETRYABLE_NETWORK]: {
    maxAttempts: 4,
    initialDelayMs: 1500,
    maxDelayMs: 12000,
    backoffMultiplier: 2,
    jitterFactor: 0.3,
  },
};

// ---------------------------------------------------------------------------
// Error Classifier — pure functions, no state
// ---------------------------------------------------------------------------

/**
 * Classifies an error into an AgentErrorCategory.
 * Uses a priority chain: cancel > network > quota > transient > malformed > input > logic.
 */
export function classifyError(error: any): AgentErrorCategory {
  const message = error?.message || String(error);
  const type = error?.type;
  const statusCode = error?.statusCode;

  // ── Network errors (check first — most specific) ──
  if (isNetworkError(error) || isFetchError(error)) {
    return AgentErrorCategory.RETRYABLE_NETWORK;
  }

  // ── Quota exhausted (billing / credits) — NOT retryable ──
  const lower = message.toLowerCase();
  if (
    (lower.includes('billing') || lower.includes('quota exceeded') || lower.includes('insufficient credits')) &&
    !lower.includes('temporarily')
  ) {
    return AgentErrorCategory.NON_RETRYABLE_QUOTA;
  }

  // ── Temporary rate limit (429) — retryable ──
  if (
    type === GeminiErrorType.QUOTA_EXCEEDED ||
    statusCode === 429 ||
    message.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('temporarily')
  ) {
    return AgentErrorCategory.RETRYABLE_RATE_LIMIT;
  }

  // ── Transient / Overloaded (5xx, timeout) ──
  if (
    type === GeminiErrorType.OVERLOADED ||
    statusCode === 503 ||
    message.includes('503') ||
    lower.includes('overloaded') ||
    lower.includes('timeout') ||
    /\berror\s+5\d{2}\b/.test(message) ||
    (statusCode && statusCode >= 500 && statusCode < 600)
  ) {
    return AgentErrorCategory.RETRYABLE_TRANSIENT;
  }

  // ── Malformed / Empty output (LLM content issues) ──
  if (
    type === GeminiErrorType.MALFORMED_FUNCTION_CALL ||
    type === GeminiErrorType.EMPTY_RESPONSE ||
    message.includes('MALFORMED_FUNCTION_CALL') ||
    message.toLowerCase().includes('empty response') ||
    message.toLowerCase().includes('failed to parse')
  ) {
    return AgentErrorCategory.RETRYABLE_MALFORMED;
  }

  // ── Input errors (context size, validation) ──
  if (
    type === GeminiErrorType.INVALID_ARGUMENT ||
    statusCode === 400 ||
    message.includes('INVALID_ARGUMENT') ||
    message.includes('400') && message.toLowerCase().includes('context') ||
    message.toLowerCase().includes('too many tokens')
  ) {
    return AgentErrorCategory.NON_RETRYABLE_INPUT;
  }

  // ── Local execution errors ──
  if (error?.code === 'LOCAL_EXEC_ERROR' || error?.code === 'IPC_ERROR') {
    return AgentErrorCategory.LOCAL_TOOL_ERROR;
  }

  // Default: non-retryable logic error
  return AgentErrorCategory.NON_RETRYABLE_LOGIC;
}

/**
 * Convenience: checks if an error is retryable (any RETRYABLE_* category).
 */
export function isRetryableError(error: any): boolean {
  const category = classifyError(error);
  return category.startsWith('RETRYABLE_');
}

/**
 * Returns the recommended retry strategy for a given error category.
 * Returns undefined for non-retryable categories.
 */
export function getStrategyForCategory(category: AgentErrorCategory): RetryStrategy | undefined {
  return RETRY_STRATEGIES[category];
}

/**
 * Maps an error category to a human-readable error code for tool results.
 */
export function categoryToErrorCode(category: AgentErrorCategory): string {
  switch (category) {
    case AgentErrorCategory.RETRYABLE_TRANSIENT: return 'TOOL_TRANSIENT_ERROR';
    case AgentErrorCategory.RETRYABLE_MALFORMED: return 'TOOL_FORMAT_ERROR';
    case AgentErrorCategory.RETRYABLE_RATE_LIMIT: return 'TOOL_RATE_LIMIT';
    case AgentErrorCategory.NON_RETRYABLE_QUOTA: return 'TOOL_QUOTA_ERROR';
    case AgentErrorCategory.RETRYABLE_NETWORK: return 'TOOL_NETWORK_ERROR';
    case AgentErrorCategory.NON_RETRYABLE_INPUT: return 'TOOL_INVALID_INPUT';
    case AgentErrorCategory.LOCAL_TOOL_ERROR: return 'TOOL_EXECUTION_ERROR';
    default: return 'TOOL_UNKNOWN_ERROR';
  }
}
