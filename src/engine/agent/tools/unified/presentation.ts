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
  tree:    ['tree'],
  cat:     null,                        // node fields spread to top level — pass through
  // Search commands
  grep:    ['results', 'properties'],   // results = node mode, properties = prop mode
  sed:     ['replaced', 'details'],
  // Info
  man:     null,                        // pass through
  // First-class tools — inspect keeps node data, strips metadata
  inspect: ['page', 'count', 'children', 'tree',
            'type', 'id', 'name', 'role', 'size', 'visual', 'layout', 'summary',
            'content', 'width', 'height', 'fill', 'fills', 'stroke', 'shadow',
            'padding', 'gap', 'radius', 'fontSize', 'fontWeight', 'fontFamily',
            'opacity', 'sizingH', 'sizingV', 'alignMain', 'alignCross', 'childCount',
            '__image'],
  jsx:     null,                        // node fields spread to top level — pass through
  // Legacy tool names
  design:  ['idMap', 'created', 'edited', 'deleted', 'failed', 'errors', 'degraded', 'degradedHint'],
  edit:    ['edited', 'failed', 'errors', 'changeSummary'],
  create:  ['idMap'],
};

/** Overflow hints per command — contextual help for the LLM. */
const OVERFLOW_HINTS: Record<string, string> = {
  tree: 'Use inspect with mode "detail" for specific node properties.',
  cat: 'Use inspect with mode "tree" to discover structure, then detail specific children.',
  grep: 'Narrow the search query or target a specific path.',
};

/**
 * Transform a raw command result into LLM-ready format.
 *
 * Flattens {success, data: {...}} into {...} — no wrapper envelope.
 * Error: presence of `error` field = failure (replaces success boolean).
 * Matches Open-Pencil's response convention: data fields at top level, error as string.
 *
 * Pipeline: raw result → exit code + stderr (from raw) → flatten data → strip noise → guards
 */
export function presentForLLM(result: any, commandName: string, durationMs: number): any {
  // 1. Exit code + stderr from raw result (before flattening)
  const exitCode = computeExitCode(result);
  const stderr = extractStderr(result);

  // 2. Flatten: merge data fields to top level, strip noise
  // Shallow clone to avoid mutating the original result.data (stored by reference in history)
  let cleaned: any = {};
  if (result?.data && typeof result.data === 'object') {
    cleaned = { ...stripForLLM(result.data, commandName) };
  } else if (typeof result?.data === 'string') {
    cleaned = { output: result.data };
  }

  // 3. Error replaces success boolean — only present on failure
  if (result?.error != null) {
    const err = result.error;
    cleaned.error = typeof err === 'string' ? err : (err?.message || 'Unknown error');
  }

  // 4. Meta footer
  cleaned._meta = formatMeta(exitCode, durationMs);

  // 5. Stderr
  if (stderr) cleaned._stderr = stderr;

  // 6. Overflow + binary guard on text fields
  const hint = OVERFLOW_HINTS[commandName];
  const TEXT_FIELDS = ['listing', 'tree'] as const;
  for (const field of TEXT_FIELDS) {
    if (cleaned[field] && typeof cleaned[field] === 'string') {
      cleaned[field] = guardBinary(truncateOverflow(cleaned[field], hint));
    }
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
  // Chain results: flatten each sub-result (same convention as top-level)
  if (data.chain && Array.isArray(data.chain)) {
    return {
      chain: data.chain.map((sub: any) => {
        const subCmd = extractCommandName(sub.command);
        const flat: any = { command: sub.command };
        if (subCmd && sub.data && typeof sub.data === 'object') {
          Object.assign(flat, stripFields(sub.data, subCmd));
        }
        if (sub.error != null) {
          const err = sub.error;
          flat.error = typeof err === 'string' ? err : (err?.message || 'error');
        }
        return flat;
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

  return stripped;
}

/** Extract command name from a chain sub-result's `command` string. */
function extractCommandName(command: string | undefined): string | undefined {
  if (!command || typeof command !== 'string') return undefined;
  return command.trim().split(/\s+/)[0];
}
