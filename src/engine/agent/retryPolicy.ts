/**
 * @file retryPolicy.ts
 * @description Unified retry strategies and error classification for the Agent Engine.
 */

import { GeminiErrorType } from '../llm-client/providers/gemini/geminiErrorHandler';

export enum AgentErrorCategory {
  RETRYABLE_TRANSIENT = 'RETRYABLE_TRANSIENT',   // e.g. 503 Overloaded, Network timeout
  RETRYABLE_MALFORMED = 'RETRYABLE_MALFORMED',   // e.g. LLM output format error, missing args
  NON_RETRYABLE_INPUT = 'NON_RETRYABLE_INPUT',   // e.g. 400 Invalid argument, context too large
  NON_RETRYABLE_LOGIC = 'NON_RETRYABLE_LOGIC',   // e.g. Code error, missing tool executor
  LOCAL_TOOL_ERROR = 'LOCAL_TOOL_ERROR'          // Errors occurring during tool execution
}

export interface RetryStrategy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_RETRY_STRATEGIES: Record<AgentErrorCategory, RetryStrategy> = {
  [AgentErrorCategory.RETRYABLE_TRANSIENT]: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffFactor: 2
  },
  [AgentErrorCategory.RETRYABLE_MALFORMED]: {
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 2000,
    backoffFactor: 1.5
  },
  [AgentErrorCategory.NON_RETRYABLE_INPUT]: {
    maxRetries: 0,
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffFactor: 1
  },
  [AgentErrorCategory.NON_RETRYABLE_LOGIC]: {
    maxRetries: 0,
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffFactor: 1
  },
  [AgentErrorCategory.LOCAL_TOOL_ERROR]: {
    maxRetries: 1, // Optional small retry for local execution if suspected transient
    initialDelayMs: 500,
    maxDelayMs: 1000,
    backoffFactor: 1
  }
};

export class RetryPolicy {
  private retryCounts: Map<string, number> = new Map();

  constructor(private strategies = DEFAULT_RETRY_STRATEGIES) {}

  /**
   * Classifies an error into an AgentErrorCategory.
   */
  public classifyError(error: any): AgentErrorCategory {
    const message = error?.message || String(error);
    const type = error?.type;

    // 1. Transient / Overloaded (Cloud API limitations)
    if (
      type === GeminiErrorType.OVERLOADED ||
      message.includes('OVERLOADED') ||
      message.includes('503') ||
      message.toLowerCase().includes('overloaded') ||
      message.toLowerCase().includes('rate limit')
    ) {
      return AgentErrorCategory.RETRYABLE_TRANSIENT;
    }

    // 2. Malformed / Empty output (LLM generation issues)
    if (
      message.includes('MALFORMED_FUNCTION_CALL') ||
      message.toLowerCase().includes('empty response') ||
      message.toLowerCase().includes('failed to parse')
    ) {
      return AgentErrorCategory.RETRYABLE_MALFORMED;
    }

    // 3. Input errors (Context size, validation)
    if (
      type === GeminiErrorType.INVALID_ARGUMENT ||
      message.includes('INVALID_ARGUMENT') ||
      (message.includes('400') && message.toLowerCase().includes('context')) ||
      message.toLowerCase().includes('too many tokens')
    ) {
      return AgentErrorCategory.NON_RETRYABLE_INPUT;
    }
    
    // 4. Local Execution Errors
    if (error?.code === 'LOCAL_EXEC_ERROR' || error?.code === 'IPC_ERROR') {
      return AgentErrorCategory.LOCAL_TOOL_ERROR;
    }

    // Default to logic error if unknown
    return AgentErrorCategory.NON_RETRYABLE_LOGIC;
  }

  /**
   * Calculates the delay for the next retry attempt.
   * Returns -1 if no more retries are allowed.
   */
  public getNextRetryDelay(category: AgentErrorCategory, key: string): number {
    const strategy = this.strategies[category];
    const currentCount = this.retryCounts.get(key) || 0;

    if (currentCount >= strategy.maxRetries) {
      return -1;
    }

    const nextCount = currentCount + 1;
    this.retryCounts.set(key, nextCount);

    const delay = Math.min(
      strategy.initialDelayMs * Math.pow(strategy.backoffFactor, nextCount - 1),
      strategy.maxDelayMs
    );

    return delay;
  }

  /**
   * Resets the retry count for a specific key.
   */
  public reset(key: string): void {
    this.retryCounts.delete(key);
  }

  /**
   * Resets all retry counts.
   */
  public resetAll(): void {
    this.retryCounts.clear();
  }
}
