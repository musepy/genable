/**
 * @file presentation.ts
 * @description Layer 2 — LLM Presentation Pipe.
 *
 * Single function that transforms raw tool results into LLM-ready format.
 * Applied once, at the shell level, after command execution.
 *
 * Pipeline: result → exit code → meta footer → stderr → overflow guard → binary guard
 *
 * Design principle: commands own their output format.
 * This pipe only adds metadata and guards against LLM cognitive limits.
 */

import {
  computeExitCode,
  formatMeta,
  extractStderr,
  truncateOverflow,
  guardBinary,
} from './exitCode';

/** Overflow hints per command — contextual help for the LLM. */
const OVERFLOW_HINTS: Record<string, string> = {
  ls: 'Use tree -d 2 for overview or cat /path/ for specific node.',
  tree: 'Use cat /path/ for specific subtree.',
  cat: 'Use tree to discover structure, then cat specific children.',
  grep: 'Narrow the search query or target a specific path.',
};

/**
 * Transform a raw command result into LLM-ready format.
 *
 * - Adds _meta footer with exit code and timing
 * - Extracts stderr from warnings/errors
 * - Guards against overflow (>200 lines) and binary content
 *
 * Does NOT modify the result's core data — commands own their output format.
 */
export function presentForLLM(result: any, commandName: string, durationMs: number): any {
  const cleaned = { ...result };

  // Strip internal `name` field (used by old cleaner for routing)
  delete cleaned.name;

  // 1. Exit code
  const exitCode = computeExitCode(result);
  cleaned._meta = formatMeta(exitCode, durationMs);

  // 2. Stderr — surface warnings/errors as separate signal
  const stderr = extractStderr(result);
  if (stderr) cleaned._stderr = stderr;

  // 3. Overflow + binary guard on text fields
  const hint = OVERFLOW_HINTS[commandName];
  const TEXT_FIELDS = ['listing', 'tree'] as const;
  for (const field of TEXT_FIELDS) {
    if (cleaned.data?.[field] && typeof cleaned.data[field] === 'string') {
      cleaned.data[field] = guardBinary(truncateOverflow(cleaned.data[field], hint));
    }
  }

  return cleaned;
}
