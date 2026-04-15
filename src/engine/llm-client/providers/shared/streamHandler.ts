/**
 * @file streamHandler.ts
 * @description Provider-agnostic stream consumption utilities.
 * Handles connect timeout and abort signal — works with any LLM provider.
 */

export interface StreamConsumerConfig {
  /** AbortSignal for external cancellation */
  abortSignal?: AbortSignal;
}

export interface StreamConsumerResult {
  aborted: boolean;
}

/**
 * Consumes an async iterable with abort signal support.
 *
 * Stream errors propagate to the caller for protocol-specific handling.
 */
export async function consumeStream<T>(
  source: AsyncIterable<T>,
  onChunk: (chunk: T) => void,
  config: StreamConsumerConfig,
): Promise<StreamConsumerResult> {
  const { abortSignal } = config;
  for await (const chunk of source) {
    if (abortSignal?.aborted) return { aborted: true };
    onChunk(chunk);
  }
  return { aborted: false };
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
