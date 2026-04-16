/**
 * @file withRetry.ts
 * @description Exponential-backoff retry wrapper for LLM provider calls.
 *
 * Design principles:
 * - Fail-fast: non-retryable errors (per isRetryable) throw immediately — the
 *   user sees the real failure, not a silent loop.
 * - Single layer: this is the ONE retry layer in the system. Providers no
 *   longer embed their own retry; the coordinator no longer runs a parallel
 *   empty-response retry.
 * - Exhaustion is loud: when maxRetries is consumed, the LAST error is
 *   re-thrown as-is (no wrapping, no fabricated "success"). Callers can still
 *   inspect the typed ProviderError.
 *
 * Out of scope (intentional YAGNI — do NOT add without discussion):
 * - Retry-After header parsing
 * - Jitter
 * - Per-error-type retry count differentiation
 * - Provider/endpoint fallback
 * - Circuit breaker / concurrency limits
 * - Background vs foreground policies
 */

import { isRetryable } from './isRetryable';
import { TransportError } from './providerErrors';

export interface WithRetryOptions {
  /**
   * Number of retries AFTER the initial attempt. Total attempts = 1 + maxRetries.
   * E.g. maxRetries=3 → up to 4 calls of fn.
   */
  maxRetries: number;
  /** Base delay in ms. Exponential: delay(attempt N) = baseDelayMs * 2^(N-1). */
  baseDelayMs: number;
  /**
   * Abort signal. If it fires during backoff wait, the pending sleep is
   * cancelled and a TransportError is thrown immediately.
   */
  abortSignal?: AbortSignal;
  /** Provider name — used for logging and error construction. */
  providerName: string;
  /**
   * Optional callback fired just before each retry attempt begins. Useful for
   * emitting runtime telemetry (e.g. failed llm_response events).
   * `attempt` is 1-based: 1 = the first retry (second overall call).
   */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

/**
 * Wraps `fn` with exponential-backoff retry based on isRetryable().
 *
 * Semantics:
 * - Initial attempt runs immediately.
 * - On throw: if !isRetryable → re-throw immediately (fail-fast).
 * - On throw at the final attempt: re-throw the last error (exhausted).
 * - Between attempts: sleep `baseDelayMs * 2^(attempt-1)`. Abort during sleep
 *   throws TransportError.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = opts.baseDelayMs * Math.pow(2, attempt - 1);
      if (opts.abortSignal?.aborted) {
        throw new TransportError(opts.providerName, 'Aborted during retry wait');
      }
      opts.onRetry?.(attempt, lastErr, delay);
      await sleepWithAbort(delay, opts.abortSignal, opts.providerName);
    }

    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) {
        // Fail-fast: surface non-retryable error to caller unchanged.
        throw err;
      }
      if (attempt === opts.maxRetries) {
        // Exhausted: re-throw the last error as-is so callers can still
        // type-narrow on ProviderError subclasses.
        throw err;
      }
      const msg = (err as any)?.message || String(err);
      console.warn(
        `[${opts.providerName}] Retryable error (attempt ${attempt + 1}/${opts.maxRetries + 1}): ${msg}`,
      );
    }
  }

  // Unreachable — the loop either returns, throws on non-retryable, or throws
  // on the final attempt. TypeScript cannot prove this, so we throw.
  throw lastErr;
}

/**
 * Promisified setTimeout with AbortSignal support. Guarantees that the timer
 * is cleared when aborted so we don't leak handles.
 */
function sleepWithAbort(
  delayMs: number,
  signal: AbortSignal | undefined,
  providerName: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const onAbort = () => {
      cleanup();
      clearTimeout(timer);
      reject(new TransportError(providerName, 'Aborted during retry wait'));
    };

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        // Already aborted — reject on next microtask to keep behavior uniform.
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
