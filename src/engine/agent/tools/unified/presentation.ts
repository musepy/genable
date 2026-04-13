/**
 * @file presentation.ts
 * @description Layer 2 — LLM Presentation Pipe.
 *
 * Single function that transforms raw tool results into LLM-ready format.
 * Applied once, at the shell level, after command execution.
 *
 * Pipeline: result → meta footer → stderr → overflow guard → binary guard → strip noise
 *
 * Design principle: commands own their output format.
 * This pipe only adds metadata, guards against LLM cognitive limits,
 * and strips noise fields that waste LLM attention budget.
 * No exit codes — error presence/absence is the only signal.
 */

import {
  formatTiming,
  extractStderr,
  truncateOverflow,
  guardBinary,
} from './exitCode';

// ---------------------------------------------------------------------------
// Per-command keep-lists — fields that survive into LLM context.
// null = pass through (no stripping). undefined/missing = pass through.
// ---------------------------------------------------------------------------

/** Fields to always strip from results (runtime-only, not for LLM). */
const STRIP_FIELDS: Record<string, string[]> = {
  jsx: ['createdIds'],  // internal: inspection tracker uses it, LLM doesn't need 69 IDs
};

const KEEP_FIELDS: Record<string, string[] | null> = {
  inspect: null,
  jsx:     null,
  edit:    ['id', 'name', 'type', 'updated', 'results'],
  // Search tools
  find_nodes:      ['results'],
  discover_props:  null,
  replace_props:   ['replaced', 'details'],
  // Structure tools
  delete_node:     ['deleted'],
  move_node:       ['id', 'name'],
  clone_node:      ['idMap'],
  // Variable & component tools — pass through
};


/**
 * Transform a raw command result into LLM-ready format.
 *
 * Flattens {success, data: {...}} into {...} — no wrapper envelope.
 * Error: presence of `error` field = failure (replaces success boolean).
 * Matches Open-Pencil's response convention: data fields at top level, error as string.
 *
 * Pipeline: raw result → stderr → flatten data → strip noise → guards
 */
export function presentForLLM(result: any, commandName: string, durationMs: number): any {
  // 1. Stderr from raw result (before flattening)
  const stderr = extractStderr(result);

  // 2. Flatten: merge data fields to top level, strip noise
  // Shallow clone to avoid mutating the original result.data (stored by reference in history)
  let cleaned: any = {};
  if (result?.data && typeof result.data === 'object') {
    cleaned = { ...stripForLLM(result.data, commandName) };
  } else if (typeof result?.data === 'string') {
    cleaned = { output: result.data };
  }

  // 3. Error — flat string, pass through
  if (result?.error != null) {
    cleaned.error = result.error;
  }

  // 4. Meta footer — timing only, no exit code
  cleaned._meta = `[${formatTiming(durationMs)}]`;

  // 5. Stderr
  if (stderr) cleaned._stderr = stderr;

  // 6. Overflow + binary guard on text fields
  const TEXT_FIELDS = ['listing', 'tree'] as const;
  for (const field of TEXT_FIELDS) {
    if (cleaned[field] && typeof cleaned[field] === 'string') {
      cleaned[field] = guardBinary(truncateOverflow(cleaned[field]));
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
          flat.error = sub.error;
        }
        return flat;
      }),
    };
  }

  return stripFields(data, commandName);
}

/** Strip a single result's data according to KEEP_FIELDS and STRIP_FIELDS. */
function stripFields(data: any, commandName: string): any {
  const keepList = KEEP_FIELDS[commandName];

  // null = pass through, undefined = unknown command → pass through
  // But still apply STRIP_FIELDS if defined
  if (keepList === null || keepList === undefined) {
    const stripList = STRIP_FIELDS[commandName];
    if (stripList) {
      const copy = { ...data };
      for (const field of stripList) delete copy[field];
      return copy;
    }
    return data;
  }

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
