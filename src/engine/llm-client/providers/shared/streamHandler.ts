/**
 * @file streamHandler.ts
 * @description Provider-agnostic stream consumption utilities.
 * Handles idle timeout, connect timeout, and abort signal — works with any LLM provider.
 */

export interface StreamConsumerConfig {
  /** Max silence between chunks before considering connection dead (ms) */
  idleTimeoutMs: number;
  /** AbortSignal for external cancellation */
  abortSignal?: AbortSignal;
}

export interface StreamConsumerResult {
  timedOut: boolean;
  aborted: boolean;
}

/**
 * Consumes an async iterable with idle timeout and abort signal support.
 *
 * Uses Promise.race() so the idle timer fires even when the stream is blocked
 * waiting for the next chunk (the old `for await` check was passive — it only
 * ran when a chunk arrived, making it useless for detecting stalled streams).
 *
 * Stream errors propagate to the caller for protocol-specific handling.
 */
export async function consumeStream<T>(
  source: AsyncIterable<T>,
  onChunk: (chunk: T) => void,
  config: StreamConsumerConfig,
): Promise<StreamConsumerResult> {
  const { idleTimeoutMs, abortSignal } = config;
  const IDLE_SENTINEL = Symbol('idle');
  const iterator = source[Symbol.asyncIterator]();
  let idleTimer: ReturnType<typeof setTimeout>;

  function resetIdleTimer(): Promise<typeof IDLE_SENTINEL> {
    clearTimeout(idleTimer);
    return new Promise<typeof IDLE_SENTINEL>(resolve => {
      idleTimer = setTimeout(() => resolve(IDLE_SENTINEL), idleTimeoutMs);
    });
  }

  try {
    let idlePromise = resetIdleTimer();
    while (true) {
      if (abortSignal?.aborted) return { timedOut: false, aborted: true };

      const result = await Promise.race([iterator.next(), idlePromise]);

      if (result === IDLE_SENTINEL) return { timedOut: true, aborted: false };

      const iterResult = result as IteratorResult<T>;
      if (iterResult.done) break;

      idlePromise = resetIdleTimer();
      onChunk(iterResult.value);
    }
    return { timedOut: false, aborted: false };
  } finally {
    clearTimeout(idleTimer!);
  }
}

/**
 * Wraps an async operation with a connect timeout.
 * If the operation doesn't resolve within `timeoutMs`, rejects with a timeout error.
 */
export async function withConnectTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Connection timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
