/**
 * @file networkErrors.ts
 * @description Network error code detection for retry classification.
 * Inspired by Gemini CLI's retry.ts — detects transient network failures
 * that are safe to retry automatically.
 */

/**
 * Network error codes that indicate transient failures.
 * These errors are typically caused by temporary network issues
 * and can be safely retried.
 */
export const RETRYABLE_NETWORK_CODES = [
  'ECONNRESET',     // Connection reset by peer
  'ETIMEDOUT',      // Connection timed out
  'EPIPE',          // Broken pipe
  'ENOTFOUND',      // DNS lookup failed
  'EAI_AGAIN',      // DNS lookup timed out
  'ECONNREFUSED',   // Connection refused
  'EPROTO',         // Protocol error (often SSL-related)
] as const;

/**
 * Extracts the error code from an error object, traversing the
 * cause chain to find nested error codes (common with SSL errors).
 */
export function getNetworkErrorCode(error: unknown): string | undefined {
  const getCode = (obj: unknown): string | undefined => {
    if (typeof obj !== 'object' || obj === null) return undefined;
    if ('code' in obj && typeof (obj as { code: unknown }).code === 'string') {
      return (obj as { code: string }).code;
    }
    return undefined;
  };

  // Check the error itself first
  const directCode = getCode(error);
  if (directCode) return directCode;

  // Traverse the cause chain (SSL errors are often nested)
  let current: unknown = error;
  const maxDepth = 5;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (typeof current !== 'object' || current === null || !('cause' in current)) {
      break;
    }
    current = (current as { cause: unknown }).cause;
    const code = getCode(current);
    if (code) return code;
  }

  return undefined;
}

/**
 * Checks if an error is a transient network error that can be retried.
 */
export function isNetworkError(error: unknown): boolean {
  const code = getNetworkErrorCode(error);
  if (!code) return false;
  return (RETRYABLE_NETWORK_CODES as readonly string[]).includes(code);
}

/**
 * Checks if an error message indicates a fetch failure.
 * This catches generic fetch errors that may not have a specific error code.
 */
export function isFetchError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.toLowerCase().includes('fetch failed');
  }
  return false;
}
