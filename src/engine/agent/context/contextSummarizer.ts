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
  if (toolName === 'create') {
    // Extract created node IDs from idMap
    const idMap = resp.data?.idMap || resp.idMap;
    if (idMap && typeof idMap === 'object') {
      const ids = Object.values(idMap).slice(0, 5);
      const suffix = Object.keys(idMap).length > 5 ? ` +${Object.keys(idMap).length - 5} more` : '';
      return `created [${ids.join(', ')}${suffix}]`;
    }
    return 'ok';
  }
  if (toolName === 'edit') {
    return summarizeEditLikeResult(resp.data);
  }
  if (toolName === 'design') {
    return summarizeDesignResult(resp.data);
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
  return 'ok';
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

function appendReceiptSignals(parts: string[], data: any): void {
  const defaultsAppliedCount = typeof data.defaultsAppliedCount === 'number'
    ? data.defaultsAppliedCount
    : (Array.isArray(data.defaultsApplied) ? data.defaultsApplied.length : 0);
  if (defaultsAppliedCount > 0) {
    const sample = Array.isArray(data.defaultsApplied)
      ? data.defaultsApplied
          .slice(0, 3)
          .map((entry: any) => entry?.property)
          .filter(Boolean)
      : [];
    parts.push(sample.length > 0
      ? `defaults ${defaultsAppliedCount} [${sample.join(', ')}]`
      : `defaults ${defaultsAppliedCount}`);
  }

  const violations = Array.isArray(data.violations) ? data.violations : [];
  if (violations.length > 0) {
    const sampleCodes = violations
      .slice(0, 3)
      .map((violation: any) => violation?.code)
      .filter(Boolean);
    parts.push(sampleCodes.length > 0
      ? `violations ${violations.length} [${sampleCodes.join(', ')}]`
      : `violations ${violations.length}`);
  }

  if (data.nodeLimitWarning) parts.push('node-limit warning');
  if (Array.isArray(data.degraded) && data.degraded.length > 0) {
    parts.push(`degraded ${data.degraded.length}`);
  }
  if (typeof data.warningCount === 'number' && data.warningCount > 0) {
    parts.push(`warnings ${data.warningCount}`);
  }
  if (typeof data.failed === 'number' && data.failed > 0) {
    parts.push(`failed ${data.failed}`);
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
