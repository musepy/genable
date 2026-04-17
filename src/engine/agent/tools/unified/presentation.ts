/**
 * @file presentation.ts
 * @description Layer 2 — LLM Presentation Pipe.
 *
 * Single function that transforms raw tool results into LLM-ready format.
 * Applied once, at the shell level, after command execution.
 *
 * Pipeline:
 *   1. Flatten `result.data` to top level (no envelope)
 *   2. Apply per-tool `presentForLLM` override if defined
 *   3. Apply overflow/binary guards to text fields
 *
 * Per-tool filtering lives in each tool's definition (`presentForLLM` method).
 * Error presence/absence is the only success signal — no exit codes.
 */

import {
  truncateOverflow,
  guardBinary,
} from './outputGuards';
import { unifiedTools } from './index';

const TOOL_BY_NAME = new Map(unifiedTools.map(t => [t.name, t]));

/**
 * Transform a raw command result into LLM-ready format.
 *
 * Flattens {success, data: {...}} into {...} — no wrapper envelope.
 * Error: presence of `error` field = failure (replaces success boolean).
 * Matches Open-Pencil's response convention: data fields at top level, error as string.
 */
export function presentForLLM(result: any, commandName: string): any {
  let cleaned: any = {};
  if (result?.data && typeof result.data === 'object') {
    cleaned = { ...transformData(result.data, commandName) };
  } else if (typeof result?.data === 'string') {
    cleaned = { output: result.data };
  }

  if (result?.error != null) {
    cleaned.error = result.error;
  }

  const TEXT_FIELDS = ['listing', 'tree'] as const;
  for (const field of TEXT_FIELDS) {
    if (cleaned[field] && typeof cleaned[field] === 'string') {
      cleaned[field] = guardBinary(truncateOverflow(cleaned[field]));
    }
  }

  return cleaned;
}

/**
 * Apply per-tool presentation to flattened data. Handles chain sub-results by
 * recursively transforming each sub-result per its own command name.
 */
function transformData(data: any, commandName: string): any {
  if (data.chain && Array.isArray(data.chain)) {
    return {
      chain: data.chain.map((sub: any) => {
        const subCmd = extractCommandName(sub.command);
        const flat: any = { command: sub.command };
        if (subCmd && sub.data && typeof sub.data === 'object') {
          Object.assign(flat, applyToolPresenter(sub.data, subCmd));
        }
        if (sub.error != null) {
          flat.error = sub.error;
        }
        return flat;
      }),
    };
  }

  return applyToolPresenter(data, commandName);
}

function applyToolPresenter(data: any, commandName: string): any {
  const def = TOOL_BY_NAME.get(commandName);
  if (def?.presentForLLM) return def.presentForLLM(data);
  return data;
}

/** Extract command name from a chain sub-result's `command` string. */
function extractCommandName(command: string | undefined): string | undefined {
  if (!command || typeof command !== 'string') return undefined;
  return command.trim().split(/\s+/)[0];
}
