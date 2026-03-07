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
 * Unlike absolute timeouts, idle timeout only triggers when no chunks arrive
 * for `idleTimeoutMs` — an active stream that keeps producing data won't be killed.
 *
 * Stream errors propagate to the caller for protocol-specific handling.
 */
export async function consumeStream<T>(
  source: AsyncIterable<T>,
  onChunk: (chunk: T) => void,
  config: StreamConsumerConfig,
): Promise<StreamConsumerResult> {
  const { idleTimeoutMs, abortSignal } = config;
  let lastChunkTime = Date.now();

  for await (const chunk of source) {
    if (abortSignal?.aborted) {
      return { timedOut: false, aborted: true };
    }

    const idleElapsed = Date.now() - lastChunkTime;
    if (idleElapsed > idleTimeoutMs) {
      return { timedOut: true, aborted: false };
    }

    lastChunkTime = Date.now();
    onChunk(chunk);
  }

  return { timedOut: false, aborted: false };
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
