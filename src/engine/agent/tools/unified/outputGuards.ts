/**
 * @file outputGuards.ts
 * @description LLM output guards: overflow truncation and binary detection.
 */

import { saveOverflow } from '../../overflowStore';

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
