/**
 * @file isRetryable.ts
 * @description Single decision point for whether a ProviderError is worth retrying.
 *
 * Design principle (fail-fast): non-retryable errors must surface to the caller
 * immediately — retrying them cannot help and only hides real bugs from the user.
 *
 * Consumed by withRetry(). Replaces the ad-hoc 5xx/connect-timeout checks that
 * used to live inside each provider's fetchWithRetry.
 */

import {
  ProviderError,
  TransportError,
  ConnectTimeoutError,
  APIError,
  EmptyResponseError,
  OutputTooLongError,
  MalformedToolCallError,
} from './providerErrors';

/**
 * Returns true iff the error is a transient failure that another attempt
 * might recover from. All other errors — including unknown non-ProviderError
 * throws — are treated as fatal.
 */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false;

  // Transport-layer hiccups are the canonical retry case.
  if (err instanceof TransportError) return true;
  if (err instanceof ConnectTimeoutError) return true;

  if (err instanceof APIError) {
    // 5xx = server/infra; 429 = rate limit. Both are transient.
    if (err.statusCode >= 500) return true;
    if (err.statusCode === 429) return true;
    // 4xx (400/401/403) = client error; retrying with the same request
    // cannot fix it, and doing so would mask real bugs.
    return false;
  }

  // Empty responses are usually a transient model hiccup (especially on
  // streaming paths). We retry once or twice, then surface — the old silent
  // retry in emptyResponseHook was deleted precisely because unbounded silent
  // retry hid real failures.
  if (err instanceof EmptyResponseError) return true;

  // Fail-fast: retrying won't fix a malformed tool call or an output that
  // genuinely hit max_tokens. The caller must change the request.
  if (err instanceof MalformedToolCallError) return false;
  if (err instanceof OutputTooLongError) return false;

  // Unknown ProviderError subclass — default to fail-fast rather than
  // quietly retrying something we haven't reasoned about.
  return false;
}
