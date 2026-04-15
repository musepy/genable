/**
 * @file contextSummarizer.ts
 * @description Mechanical summarizer for context compression.
 *
 * Before hiding old messages, extracts a compact summary capturing:
 * - What the user asked
 * - What tools were called and key results (node IDs, errors)
 * - Agent's text responses
 *
 * No LLM call — pure extraction from message content. Fast and deterministic.
 */

import { LLMMessage, Part } from '../../llm-client/providers/types';
import { getContextProfile } from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TurnDigest {
  /** User's request text (truncated) */
  userRequest?: string;
  /** Tool calls: name + condensed result */
  toolActions: string[];
  /** Agent's text response (truncated) */
  agentResponse?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a compact summary from messages that are about to be hidden.
 * Returns a single string suitable for injection as a pinned context message.
 *
 * @param messagesToSummarize - Messages that will be hidden (in order)
 * @returns Summary text, or empty string if nothing meaningful to summarize
 */
export function buildCompressionSummary(messagesToSummarize: LLMMessage[]): string {
  const turns = groupIntoTurns(messagesToSummarize);
  if (turns.length === 0) return '';

  const lines: string[] = ['[Conversation history — compressed]'];

  for (const turn of turns) {
    if (turn.userRequest) {
      lines.push(`User: ${turn.userRequest}`);
    }
    for (const action of turn.toolActions) {
      lines.push(`  ${action}`);
    }
    if (turn.agentResponse) {
      lines.push(`Agent: ${turn.agentResponse}`);
    }
  }

  return lines.join('\n');
}

/**
 * Cap summary length by dropping oldest turns.
 * Error-priority: turns with failures are retained longer than success-only turns.
 */
export function capSummary(summary: string, maxChars: number): string {
  if (summary.length <= maxChars) return summary;
  // Split by turn boundaries (User: lines)
  const turns = summary.split(/(?=^User: )/m);

  // Two-pass drop: first drop success-only old turns, then error turns
  const hasError = (turn: string) => /\bFAIL\b|PARTIAL_FAILURE|failed \d|errors \[/.test(turn);

  // Pass 1: drop oldest success-only turns
  while (turns.length > 1 && turns.join('').length > maxChars) {
    const dropIdx = turns.findIndex(t => !hasError(t));
    if (dropIdx < 0) break; // all turns have errors
    turns.splice(dropIdx, 1);
  }

  // Pass 2: if still over budget, drop oldest error turns
  while (turns.length > 1 && turns.join('').length > maxChars) {
    turns.shift();
  }

  return '[Earlier history truncated]\n' + turns.join('');
}

// ---------------------------------------------------------------------------
// Internal: group messages into logical turns
// ---------------------------------------------------------------------------

function groupIntoTurns(messages: LLMMessage[]): TurnDigest[] {
  const turns: TurnDigest[] = [];
  let current: TurnDigest = { toolActions: [] };

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    // Skip existing summary messages
    if (msg.summaryOf && msg.summaryOf.length > 0) continue;

    if (msg.role === 'user') {
      // New turn boundary — flush previous if it has content
      if (current.userRequest || current.toolActions.length > 0 || current.agentResponse) {
        turns.push(current);
      }
      current = {
        userRequest: truncate(extractText(msg.content), getContextProfile().summaryUserRequestChars),
        toolActions: [],
      };
    } else if (msg.role === 'model') {
      extractModelContent(msg.content, current);
    } else if (msg.role === 'tool') {
      extractToolResults(msg.content, current);
    }
  }

  // Flush last turn
  if (current.userRequest || current.toolActions.length > 0 || current.agentResponse) {
    turns.push(current);
  }

  return turns;
}

// ---------------------------------------------------------------------------
// Content extractors
// ---------------------------------------------------------------------------

function extractModelContent(content: string | Part[], turn: TurnDigest): void {
  if (typeof content === 'string') {
    if (content.trim()) {
      turn.agentResponse = truncate(content.trim(), getContextProfile().summaryAgentResponseChars);
    }
    return;
  }

  for (const part of content) {
    if (part.thought) continue; // Skip thinking content

    if (part.text && part.text.trim()) {
      turn.agentResponse = truncate(part.text.trim(), getContextProfile().summaryAgentResponseChars);
    }
    if (part.functionCall) {
      const args = summarizeArgs(part.functionCall.name, part.functionCall.args);
      turn.toolActions.push(`→ ${part.functionCall.name}(${args})`);
    }
  }
}

function extractToolResults(content: string | Part[], turn: TurnDigest): void {
  if (typeof content === 'string') return;

  for (const part of content) {
    if (!part.functionResponse) continue;
    const resp = part.functionResponse.response;
    if (!resp) continue;

    const name = part.functionResponse.name;

    // Already compressed by turnResultCompressor — reuse its summary directly
    if (resp._compressed && resp.summary) {
      const brief = resp.error != null
        ? `FAIL: ${resp.summary}`
        : resp.summary;
      let pendingIdx = -1;
      for (let i = turn.toolActions.length - 1; i >= 0; i--) {
        if (turn.toolActions[i].startsWith(`→ ${name}(`)) { pendingIdx = i; break; }
      }
      if (pendingIdx >= 0) {
        turn.toolActions[pendingIdx] += ` → ${brief}`;
      } else {
        turn.toolActions.push(`→ ${name} → ${brief}`);
      }
      continue;
    }

    const ok = resp.error == null;
    const brief = ok
      ? summarizeSuccessResult(name, resp)
      : summarizeFailResult(name, resp);

    // Replace the last matching "→ name(...)" with result, or append
    let pendingIdx = -1;
    for (let i = turn.toolActions.length - 1; i >= 0; i--) {
      if (turn.toolActions[i].startsWith(`→ ${name}(`)) { pendingIdx = i; break; }
    }
    if (pendingIdx >= 0) {
      turn.toolActions[pendingIdx] += ` → ${brief}`;
    } else {
      turn.toolActions.push(`→ ${name} → ${brief}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeArgs(toolName: string, args: any): string {
  if (!args || typeof args !== 'object') return '';

  // Tools with large XML/content payloads — show length + parentId
  if (toolName === 'edit' || toolName === 'jsx') {
    const xml = args.xml || args.content || '';
    const parts: string[] = [];
    if (typeof xml === 'string' && xml.length > 0) {
      parts.push(xml.length > 40 ? `${xml.length} chars` : truncate(xml, 40));
    }
    if (args.parentId) parts.push(`parent:${args.parentId}`);
    return parts.join(', ');
  }

  // Read tools — show target node
  if (toolName === 'inspect' || toolName === 'describe') {
    return args.nodeId || args.id || '';
  }

  // Generic: show first string-valued arg
  for (const val of Object.values(args)) {
    if (typeof val === 'string' && val.length > 0) return truncate(val, 40);
  }
  return '';
}

/**
 * Summarize a failed tool result with error details preserved.
 * Error details are critical for cross-turn learning — the LLM must know
 * WHY something failed, not just THAT it failed.
 */
function summarizeFailResult(toolName: string, resp: any): string {
  const errorMsg = truncate(String(resp.error || ''), 100);

  // PARTIAL_FAILURE: detected by presence of data.errors array
  if (Array.isArray(resp.data?.errors) && resp.data) {
    const parts: string[] = [`PARTIAL_FAILURE: ${errorMsg}`];

    // Per-op error details
    if (Array.isArray(resp.data.errors)) {
      const errorDetails = resp.data.errors
        .slice(0, 3)
        .map((e: any) => `${e.op}: ${truncate(String(e.error || ''), 50)}`)
        .join('; ');
      parts.push(`errors [${errorDetails}]`);
    }

    // Surviving idMap (successful nodes from partial failure)
    appendIdMapSummary(parts, resp.data.idMap);

    return parts.join(', ');
  }

  // BATCH_TOO_LARGE: preserve the specific message so LLM knows to split
  if (errorMsg.toLowerCase().includes('batch') || errorMsg.toLowerCase().includes('too large')) {
    return `FAIL(BATCH_TOO_LARGE): ${errorMsg}`;
  }

  return `FAIL: ${errorMsg}`;
}

function summarizeSuccessResult(toolName: string, resp: any): string {
  // Creation tools with idMap
  if (toolName === 'jsx' || toolName === 'clone_node') {
    return summarizeIdMap(resp.data?.idMap || resp.idMap);
  }

  // Edit tool
  if (toolName === 'edit') {
    return summarizeEditLikeResult(resp.data);
  }

  // Read tools — show content length
  if (toolName === 'inspect' || toolName === 'describe') {
    const content = resp.data?.tree ?? resp.data?.xml ?? resp.data;
    if (typeof content === 'string') return `${content.length} chars`;
    return 'ok';
  }

  // Search tools — show results count
  if (toolName === 'find_nodes' || toolName === 'discover_props') {
    const results = resp.data?.results;
    if (Array.isArray(results)) return `${results.length} results`;
    return 'ok';
  }

  // Bulk replace
  if (toolName === 'replace_props') {
    return resp.data?.replaced != null ? `replaced ${resp.data.replaced}` : 'ok';
  }

  // Delete
  if (toolName === 'delete_node') {
    const n = resp.data?.deleted;
    return n ? `deleted ${n}` : 'ok';
  }

  // Move/rename
  if (toolName === 'move_node') {
    return resp.data?.name ? `→ ${resp.data.name}` : 'ok';
  }

  return 'ok';
}

/** Summarize idMap → "Card=962:1, Title=962:5" */
function summarizeIdMap(idMap: any): string {
  if (!idMap || typeof idMap !== 'object') return 'ok';
  const entries = Object.entries(idMap);
  if (entries.length === 0) return 'ok';
  const sample = entries.slice(0, 5).map(([k, v]) => `${k}=${v}`);
  const suffix = entries.length > 5 ? ` +${entries.length - 5} more` : '';
  return `created [${sample.join(', ')}${suffix}]`;
}

function summarizeEditLikeResult(data: any): string {
  if (!data || typeof data !== 'object') return 'ok';

  const parts: string[] = [];
  const edited = typeof data.edited === 'number'
    ? data.edited
    : (typeof data.editedCount === 'number' ? data.editedCount : data.results?.length);
  if (edited) parts.push(`edited ${edited}`);

  appendReceiptSignals(parts, data);

  return parts.join(', ') || 'ok';
}

/**
 * Append receipt signals to summary parts.
 * After noise stripping in presentation.ts, only `failed` and `degraded` survive
 * in the presented data. Other signals (defaults, violations, warnings) are in _stderr.
 */
function appendReceiptSignals(parts: string[], data: any): void {
  if (typeof data.failed === 'number' && data.failed > 0) {
    parts.push(`failed ${data.failed}`);
  }
  if (Array.isArray(data.degraded) && data.degraded.length > 0) {
    parts.push(`degraded ${data.degraded.length}`);
  }
}

function appendIdMapSummary(parts: string[], idMap: any): void {
  if (!idMap || typeof idMap !== 'object') return;

  const entries = Object.entries(idMap);
  if (entries.length === 0) return;

  const sample = entries
    .slice(0, 3)
    .map(([key, value]) => `${key}=${value}`);
  const suffix = entries.length > 3 ? ` +${entries.length - 3} more` : '';
  parts.push(`ids [${sample.join(', ')}${suffix}]`);
}

function extractText(content: string | Part[]): string {
  if (typeof content === 'string') return content;
  for (const part of content) {
    if (part.text && !part.thought) return part.text;
  }
  return '';
}

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\n/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '…';
}
