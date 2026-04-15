/**
 * @file exitCode.ts
 * @description LLM presentation utilities: timing, stderr, overflow, binary guards.
 *
 * No exit codes — error presence/absence is the only signal (OpenPencil convention).
 *
 * Timing format:
 * - <1000ms → "12ms" (cheap, call freely)
 * - ≥1000ms → "3.2s" (moderate/expensive, mind frequency)
 */

import { saveOverflow } from '../../overflowStore';

// ── Meta formatting ────────────────────────────────────────────────

/**
 * Format human-readable timing string.
 * <1000ms → "12ms", ≥1000ms → "3.2s"
 */
export function formatTiming(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

// ── Stderr formatting ──────────────────────────────────────────────

/**
 * Extract stderr from a tool result.
 *
 * Commands that build stderr at the source set `result._stderr` directly.
 * This function checks for that first, then falls back to extracting
 * from legacy data fields for commands not yet migrated.
 */
export function extractStderr(result: any): string | null {
  const parts: string[] = [];

  // Pre-built stderr from source — command already wrote its own stderr
  if (result?._stderr && typeof result._stderr === 'string') {
    parts.push(result._stderr);
  }

  // Per-op errors from receipt (PARTIAL_FAILURE details) — always in data
  if (result?.data?.errors && Array.isArray(result.data.errors)) {
    for (const e of result.data.errors) {
      parts.push(`[error] ${e.op}: ${e.error}`);
    }
  }

  // Error message (only for failed results)
  if (result?.error != null && typeof result.error === 'string') {
    parts.push(`[error] ${result.error}`);
  }

  // Legacy fallback: extract from data fields if no pre-built stderr
  if (!result?._stderr) {
    if (result?.data?.diagnostics && Array.isArray(result.data.diagnostics)) {
      for (const d of result.data.diagnostics) {
        parts.push(`[${d.severity || 'warn'}] ${d.message || JSON.stringify(d)}`);
      }
    }
    if (result?.data?.violations && Array.isArray(result.data.violations)) {
      for (const v of result.data.violations) {
        const msg = typeof v === 'string' ? v : v.message || JSON.stringify(v);
        const fix = (typeof v === 'object' && v.fix) ? ` Fix: ${v.fix}` : '';
        parts.push(`[${v.severity || 'warn'}] ${msg}.${fix}`);
      }
    }
    if (result?.data?.warnings && Array.isArray(result.data.warnings)) {
      for (const w of result.data.warnings) {
        parts.push(`[warn] ${typeof w === 'string' ? w : w.message || JSON.stringify(w)}`);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

// ── Overflow guard ─────────────────────────────────────────────────

/** Max lines before truncation in LLM presentation. */
export const MAX_OUTPUT_LINES = 200;

/**
 * Truncate text output if it exceeds MAX_OUTPUT_LINES.
 * Saves full output to overflow store for progressive retrieval.
 * LLM can explore via: more <id> | grep <pattern>
 */
export function truncateOverflow(text: string, hint?: string): string {
  const lines = text.split('\n');
  if (lines.length <= MAX_OUTPUT_LINES) return text;

  // Save full output for progressive retrieval
  const overflowId = saveOverflow(text);

  const truncated = lines.slice(0, MAX_OUTPUT_LINES).join('\n');
  const remaining = lines.length - MAX_OUTPUT_LINES;
  const explore = `Saved as overflow/${overflowId}. Explore: more ${overflowId} | grep <pattern>`;
  const suffix = hint
    ? `\n[+${remaining} lines truncated. ${explore} ${hint}]`
    : `\n[+${remaining} lines truncated. ${explore}]`;
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
