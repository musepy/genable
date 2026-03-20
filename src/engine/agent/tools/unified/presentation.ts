/**
 * @file presentation.ts
 * @description Layer 2 — LLM Presentation Pipe.
 *
 * Single function that transforms raw tool results into LLM-ready format.
 * Applied once, at the shell level, after command execution.
 *
 * Pipeline: result → exit code → meta footer → stderr → overflow guard → binary guard → strip noise
 *
 * Design principle: commands own their output format.
 * This pipe only adds metadata, guards against LLM cognitive limits,
 * and strips noise fields that waste LLM attention budget.
 */

import {
  computeExitCode,
  formatMeta,
  extractStderr,
  truncateOverflow,
  guardBinary,
} from './exitCode';

// ---------------------------------------------------------------------------
// Per-command keep-lists — fields that survive into LLM context.
// null = pass through (no stripping). undefined/missing = pass through.
// ---------------------------------------------------------------------------

const KEEP_FIELDS: Record<string, string[] | null> = {
  // Write commands — LLM needs IDs to reference created nodes + error details for repair
  mk:      ['idMap', 'created', 'failed', 'errors', 'degraded', 'degradedHint'],
  cp:      ['idMap'],
  rm:      ['deleted'],
  mv:      ['id', 'name'],
  // Read commands — LLM needs the content
  ls:      ['listing'],
  tree:    ['tree'],
  cat:     ['tree', '__image'],
  // Search commands
  grep:    ['results', 'properties'],   // results = node mode, properties = prop mode
  sed:     ['replaced', 'details'],
  // Info
  man:     null,                        // pass through
  // First-class tools
  inspect: null,                        // delegates to ls/tree/cat — pass through
  jsx:     ['idMap', 'created', 'failed', 'errors'],
  // Legacy tool names
  design:  ['idMap', 'created', 'edited', 'deleted', 'failed', 'errors', 'degraded', 'degradedHint'],
  edit:    ['idMap', 'edited', 'failed', 'errors', 'changeSummary'],
  create:  ['idMap'],
};

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

  // 4. Strip noise — keep only fields the LLM needs per command
  if (cleaned.data && typeof cleaned.data === 'object') {
    cleaned.data = stripForLLM(cleaned.data, commandName);
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Noise stripping — removes fields that waste LLM attention budget
// ---------------------------------------------------------------------------

/**
 * Strip noise from tool result data, keeping only fields the LLM needs.
 *
 * For chain results, each sub-result is stripped per its command name.
 * Unknown commands pass through unchanged.
 */
function stripForLLM(data: any, commandName: string): any {
  // Chain results: strip each sub-result's data individually
  if (data.chain && Array.isArray(data.chain)) {
    return {
      chain: data.chain.map((sub: any) => {
        const subCmd = extractCommandName(sub.command);
        if (!subCmd || !sub.data || typeof sub.data !== 'object') return sub;
        const result: any = { command: sub.command };
        result.data = stripFields(sub.data, subCmd);
        if (sub.success === false) {
          result.success = false;
          if (sub.error) result.error = sub.error;
        }
        return result;
      }),
    };
  }

  return stripFields(data, commandName);
}

/** Strip a single result's data according to KEEP_FIELDS. */
function stripFields(data: any, commandName: string): any {
  const keepList = KEEP_FIELDS[commandName];

  // null = pass through, undefined = unknown command → pass through
  if (keepList === null || keepList === undefined) return data;

  const stripped: any = {};
  for (const field of keepList) {
    if (data[field] !== undefined && data[field] !== null) {
      // Skip empty arrays and empty objects
      if (Array.isArray(data[field]) && data[field].length === 0) continue;
      if (typeof data[field] === 'object' && !Array.isArray(data[field]) && Object.keys(data[field]).length === 0) continue;
      stripped[field] = data[field];
    }
  }

  // Keep failure signals — LLM needs to know about errors
  if (data.success === false) {
    stripped.success = false;
    if (data.error) stripped.error = data.error;
  }
  // Strip redundant success: true (exit:0 in _meta already signals this)

  return stripped;
}

/** Extract command name from a chain sub-result's `command` string. */
function extractCommandName(command: string | undefined): string | undefined {
  if (!command || typeof command !== 'string') return undefined;
  return command.trim().split(/\s+/)[0];
}
