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
 * Preserves the most recent conversation history within the budget.
 */
export function capSummary(summary: string, maxChars: number): string {
  if (summary.length <= maxChars) return summary;
  // Split by turn boundaries (User: lines)
  const turns = summary.split(/(?=^User: )/m);
  // Drop oldest turns until fits
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
    const ok = resp.success !== false;
    const brief = ok
      ? summarizeSuccessResult(name, resp)
      : `FAIL: ${truncate(String(resp.error?.message || resp.error || ''), 80)}`;

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

  if (toolName === 'create' || toolName === 'edit' || toolName === 'design') {
    // XML content — just show length
    const xml = args.xml || args.content || '';
    const parts: string[] = [];
    if (typeof xml === 'string' && xml.length > 0) {
      parts.push(xml.length > 40 ? `${xml.length} chars` : truncate(xml, 40));
    }
    if (args.parentId) parts.push(`parent:${args.parentId}`);
    return parts.join(', ');
  }
  if (toolName === 'context') {
    return '';
  }
  if (toolName === 'outline' || toolName === 'inspect') {
    return args.nodeId || args.id || '';
  }
  if (toolName === 'ls' || toolName === 'tree' || toolName === 'cat') {
    return args.path || '/';
  }
  if (toolName === 'query' || toolName === 'query_knowledge') {
    return `${args.source || ''}:${truncate(args.query || '', 40)}`;
  }

  // Generic: show first string-valued arg
  for (const val of Object.values(args)) {
    if (typeof val === 'string' && val.length > 0) return truncate(val, 40);
  }
  return '';
}

function summarizeSuccessResult(toolName: string, resp: any): string {
  if (toolName === 'create' || toolName === 'mk' || toolName === 'cp') {
    return summarizeIdMap(resp.data?.idMap || resp.idMap);
  }
  if (toolName === 'edit') {
    return summarizeEditLikeResult(resp.data);
  }
  if (toolName === 'design') {
    return summarizeDesignResult(resp.data);
  }
  if (toolName === 'rm') {
    const n = resp.data?.deleted;
    return n ? `deleted ${n}` : 'ok';
  }
  if (toolName === 'mv') {
    return resp.data?.name ? `→ ${resp.data.name}` : 'ok';
  }
  if (toolName === 'context') {
    const childCount = resp.data?.page?.childCount;
    return childCount ? `page with ${childCount} nodes` : 'ok';
  }
  if (toolName === 'outline' || toolName === 'inspect') {
    const tree = resp.data?.tree ?? resp.data?.xml ?? resp.data;
    if (typeof tree === 'string') return `${tree.length} chars`;
    return 'ok';
  }
  if (toolName === 'ls') {
    const listing = resp.data?.listing;
    if (typeof listing === 'string') return `${listing.split('\n').length} items`;
    return resp.data?.count !== undefined ? `${resp.data.count} items` : 'ok';
  }
  if (toolName === 'tree' || toolName === 'cat') {
    const tree = resp.data?.tree ?? resp.data?.listing ?? resp.data;
    if (typeof tree === 'string') return `${tree.length} chars`;
    return 'ok';
  }
  if (toolName === 'grep') {
    const results = resp.data?.results;
    if (Array.isArray(results)) return `${results.length} matches`;
    return 'ok';
  }
  if (toolName === 'sed') {
    return resp.data?.replaced != null ? `replaced ${resp.data.replaced}` : 'ok';
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

function summarizeDesignResult(data: any): string {
  if (!data || typeof data !== 'object') return 'ok';

  const parts: string[] = [];
  if (typeof data.created === 'number' && data.created > 0) parts.push(`created ${data.created}`);
  if (typeof data.edited === 'number' && data.edited > 0) parts.push(`edited ${data.edited}`);
  if (typeof data.deleted === 'number' && data.deleted > 0) parts.push(`deleted ${data.deleted}`);

  appendIdMapSummary(parts, data.idMap);
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
