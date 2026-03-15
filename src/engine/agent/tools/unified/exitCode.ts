/**
 * @file exitCode.ts
 * @description Unix-standard exit codes and metadata formatting.
 *
 * Layer 2 (LLM Presentation): exit code + timing metadata.
 * - exit:0 — success, result is trustworthy
 * - exit:1 — general error, check output
 * - exit:127 — command not found, change direction
 *
 * Timing format:
 * - <1000ms → "12ms" (cheap, call freely)
 * - ≥1000ms → "3.2s" (moderate/expensive, mind frequency)
 */

// ── Exit code mapping ──────────────────────────────────────────────

/** Standard Unix exit codes. */
export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_NOT_FOUND = 127;

/** Error codes that map to exit:127 (command/path not found). */
const NOT_FOUND_CODES = new Set([
  'UNKNOWN_COMMAND',
  'COMMAND_NOT_FOUND',
  'NO_TOOL_EXECUTOR',
  'PATH_NOT_FOUND',
  'NODE_NOT_FOUND',
]);

/**
 * Compute Unix exit code from a tool result.
 * Convention: success=true → 0, not-found errors → 127, other errors → 1.
 */
export function computeExitCode(result: any): number {
  if (!result) return EXIT_ERROR;
  if (result.success !== false) return EXIT_SUCCESS;

  const code = result.error?.code;
  if (code && NOT_FOUND_CODES.has(code)) return EXIT_NOT_FOUND;

  return EXIT_ERROR;
}

// ── Meta formatting ────────────────────────────────────────────────

/**
 * Format human-readable timing string.
 * <1000ms → "12ms", ≥1000ms → "3.2s"
 */
export function formatTiming(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * Format the `_meta` footer for tool results.
 * Unix-standard: `[exit:0 | 12ms]`
 */
export function formatMeta(exitCode: number, durationMs: number): string {
  return `[exit:${exitCode} | ${formatTiming(durationMs)}]`;
}

// ── Stderr formatting ──────────────────────────────────────────────

/**
 * Extract and format stderr from warnings/errors in a result.
 * Returns null if no stderr content.
 */
export function extractStderr(result: any): string | null {
  const parts: string[] = [];

  // Warnings from executor
  if (result?.data?.warnings && Array.isArray(result.data.warnings)) {
    for (const w of result.data.warnings) {
      parts.push(`[warn] ${typeof w === 'string' ? w : w.message || JSON.stringify(w)}`);
    }
  }

  // Violations from executor
  if (result?.data?.violations && Array.isArray(result.data.violations)) {
    for (const v of result.data.violations) {
      parts.push(`[warn] ${typeof v === 'string' ? v : v.message || JSON.stringify(v)}`);
    }
  }

  // Error message (only for failed results)
  if (result?.success === false && result?.error?.message) {
    parts.push(`[error] ${result.error.message}`);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

// ── Overflow guard ─────────────────────────────────────────────────

/** Max lines before truncation in LLM presentation. */
export const MAX_OUTPUT_LINES = 200;

/**
 * Truncate text output if it exceeds MAX_OUTPUT_LINES.
 * Cuts at line boundary, appends hint about how to get full data.
 */
export function truncateOverflow(text: string, hint?: string): string {
  const lines = text.split('\n');
  if (lines.length <= MAX_OUTPUT_LINES) return text;

  const truncated = lines.slice(0, MAX_OUTPUT_LINES).join('\n');
  const remaining = lines.length - MAX_OUTPUT_LINES;
  const suffix = hint
    ? `\n[+${remaining} lines truncated. ${hint}]`
    : `\n[+${remaining} lines truncated]`;
  return truncated + suffix;
}

// ── Binary guard ───────────────────────────────────────────────────

/**
 * Detect binary/garbled content that would confuse the LLM.
 * Returns true if content appears to be binary.
 */
export function isBinaryContent(content: string): boolean {
  if (!content || content.length === 0) return false;

  // Check for high ratio of non-printable characters
  const sampleSize = Math.min(content.length, 1024);
  let nonPrintable = 0;
  for (let i = 0; i < sampleSize; i++) {
    const code = content.charCodeAt(i);
    // Allow: tab(9), newline(10), carriage return(13), printable ASCII (32-126), common Unicode
    if (code < 9 || (code > 13 && code < 32) || (code > 126 && code < 160)) {
      nonPrintable++;
    }
  }

  return nonPrintable / sampleSize > 0.1; // >10% non-printable = binary
}

/**
 * Guard against binary content in tool results.
 * Replaces binary data with a descriptive message.
 */
export function guardBinary(content: string, sizeBytes?: number): string {
  if (!isBinaryContent(content)) return content;
  const size = sizeBytes ?? new Blob([content]).size;
  const sizeStr = size > 1024 ? `${(size / 1024).toFixed(0)}KB` : `${size}B`;
  return `[binary data (${sizeStr}). Use cat -s for screenshot, or grep for specific properties.]`;
}
