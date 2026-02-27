/**
 * @file retryWithBackoff.ts
 * @description Generic retry engine with exponential backoff and jitter.
 * Inspired by Gemini CLI's retry.ts — handles transient errors automatically
 * while respecting abort signals and providing retry telemetry via callbacks.
 */

/**
 * Configuration for the retry engine.
 */
export interface RetryOptions {
  /** Maximum number of attempts (including the first call). Default: 4 */
  maxAttempts: number;
  /** Initial delay in milliseconds before the first retry. Default: 2000 */
  initialDelayMs: number;
  /** Maximum delay cap in milliseconds. Default: 15000 */
  maxDelayMs: number;
  /** Jitter factor (0-1). Adds randomness to prevent thundering herd. Default: 0.3 */
  jitterFactor: number;
  /** Backoff multiplier applied after each retry. Default: 2 */
  backoffMultiplier: number;
  /** Predicate: should this error trigger a retry? */
  shouldRetry: (error: Error) => boolean;
  /** Optional callback invoked before each retry. Useful for telemetry/logging. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  /** Optional callback invoked before each retry to inject hints into context. */
  onBeforeRetry?: (attempt: number, error: unknown) => void;
  /** Optional AbortSignal for cancellation support. */
  signal?: AbortSignal;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 4,
  initialDelayMs: 2000,
  maxDelayMs: 15000,
  jitterFactor: 0.3,
  backoffMultiplier: 2,
  shouldRetry: () => false,
};

/**
 * Calculates the delay for a retry attempt with exponential backoff and jitter.
 *
 * Formula: base = initialDelay * backoff^(attempt-1)
 *          jitter = base * factor * (random * 2 - 1)   // ±factor%
 *          finalDelay = clamp(base + jitter, 0, maxDelay)
 */
export function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitterFactor: number,
): number {
  const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  const jitter = baseDelay * jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.min(maxDelayMs, baseDelay + jitter));
}

/**
 * Delays execution for the specified duration, respecting abort signals.
 * Resolves immediately if the signal is already aborted.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AbortError());

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Custom AbortError for consistency across environments.
 */
class AbortError extends Error {
  constructor() {
    super('Retry aborted');
    this.name = 'AbortError';
  }
}

/**
 * Retries an async function with exponential backoff and jitter.
 *
 * Key features:
 * - Exponential backoff with configurable multiplier
 * - Random jitter to prevent thundering herd
 * - AbortSignal support for cancellation
 * - onRetry callback for telemetry/logging
 * - onBeforeRetry callback for injecting error hints
 *
 * @throws The last error if all attempts are exhausted
 * @throws AbortError if the signal is aborted during retry
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };

  if (opts.signal?.aborted) {
    throw new AbortError();
  }

  if (opts.maxAttempts <= 0) {
    throw new Error('maxAttempts must be a positive number.');
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new AbortError();
    }

    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // AbortError — never retry
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }

      // Check if we should retry
      const isRetryable = opts.shouldRetry(error);
      if (!isRetryable || attempt >= opts.maxAttempts) {
        throw error;
      }

      // Calculate delay with jitter
      const retryDelay = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier,
        opts.jitterFactor,
      );

      // Notify before retry (for inserting hints, telemetry, etc.)
      opts.onBeforeRetry?.(attempt, error);
      opts.onRetry?.(attempt, error, retryDelay);

      // Wait before retrying
      await delay(retryDelay, opts.signal);
    }
  }

  // Should not reach here, but just in case
  throw lastError ?? new Error('Retry attempts exhausted');
}
