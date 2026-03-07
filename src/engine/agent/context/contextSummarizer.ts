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
        userRequest: truncate(extractText(msg.content), 120),
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
      turn.agentResponse = truncate(content.trim(), 150);
    }
    return;
  }

  for (const part of content) {
    if (part.thought) continue; // Skip thinking content

    if (part.text && part.text.trim()) {
      turn.agentResponse = truncate(part.text.trim(), 150);
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

  if (toolName === 'create' || toolName === 'edit') {
    // XML content — just show length
    const xml = args.xml || args.content || '';
    return xml.length > 40 ? `${xml.length} chars` : truncate(xml, 40);
  }
  if (toolName === 'read') {
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
    const count = resp.data?.editedCount || resp.data?.results?.length;
    return count ? `edited ${count} nodes` : 'ok';
  }
  if (toolName === 'read') {
    const xml = resp.data?.xml || resp.data;
    if (typeof xml === 'string') return `${xml.length} chars`;
    return 'ok';
  }
  return 'ok';
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
