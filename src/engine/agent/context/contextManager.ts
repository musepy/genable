/**
 * @file contextManager.ts
 * @description Flat message journal with inline summary.
 *
 * State (Pimono-style):
 *   systemPrompt: string          — static, set once, never mutated
 *   messages: LLMMessage[]        — flat journal; summary lives as the first
 *                                   entry when compaction has run
 *
 * Summary representation: a synthetic user message with `summaryOf` populated
 * (markers already defined on LLMMessage). The summarizer skips it during
 * serialization, and the provider bridge treats it as regular user text.
 *
 * Turn boundary is inferred, not tracked: walk back from the end of the
 * journal to the last user message. Everything from that index onward is
 * "the current turn"; everything before is history.
 *
 * Lazy compression: full messages are preserved across turns. Only when the
 * total context approaches the budget does endTurn() evict the oldest
 * pre-current-turn messages into the summary.
 */

import { LLMMessage, ContentBlock, LLMProvider } from '../../llm-client/providers/types';
import { buildCompressionSummary, capSummary } from './contextSummarizer';
import { getContextProfile } from './constants';
import type {
  ContextLayerBreakdown,
  ContextLayerMessagePreview,
} from '../../../shared/protocol/agentRuntimeEvents';

export interface ContextManagerOptions {
  systemPrompt: string;
  contextBudgetChars: number;
  provider: LLMProvider;
}

const SUMMARY_MARKER = '__context_summary__';

function isSummaryMessage(msg: LLMMessage): boolean {
  return Array.isArray(msg.summaryOf) && msg.summaryOf.includes(SUMMARY_MARKER);
}

function makeSummaryMessage(summary: string): LLMMessage {
  return {
    id: 'ctx_summary',
    role: 'user',
    content: `Previous conversation summary: ${summary}`,
    summaryOf: [SUMMARY_MARKER],
  };
}

export class ContextManager {
  private readonly systemPrompt: string;
  private readonly contextBudgetChars: number;
  private readonly provider: LLMProvider;
  private messages: LLMMessage[] = [];
  private lastPromptTokens: number = 0;

  constructor(opts: ContextManagerOptions) {
    this.systemPrompt = opts.systemPrompt;
    this.contextBudgetChars = opts.contextBudgetChars;
    this.provider = opts.provider;
  }

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Assemble the prompt sent to the LLM.
   * Returns system prompt separately (providers pass it natively);
   * `messages` is the flat journal with the summary (if any) at index 0.
   *
   * Includes an intra-turn budget gate: if total context exceeds budget,
   * older model+tool pairs within the current turn get their tool_call args
   * compressed in place. Prevents unbounded growth within a single turn
   * (e.g. 18 JSX iterations accumulating ~126K chars).
   */
  assemblePrompt(): { system: string; messages: LLMMessage[] } {
    this.compressTurnIfOverBudget();
    return { system: this.systemPrompt, messages: this.messages.slice() };
  }

  /**
   * End-of-turn pipeline: lazily evict oldest pre-turn messages into the
   * summary when over budget. Intra-turn compression is disabled to preserve
   * KV-cache hits and full tool-result context.
   */
  async endTurn(): Promise<void> {
    await this.compressIfNeeded();
  }

  /** Whether no user turn has completed yet. */
  isFirstTurn(): boolean {
    let userCount = 0;
    for (const msg of this.messages) {
      if (msg.role === 'user' && !isSummaryMessage(msg)) {
        userCount++;
        if (userCount > 1) return false;
      }
    }
    return userCount <= 1;
  }

  // ─── Message operations ─────────────────────────────────────

  addMessage(msg: LLMMessage): void {
    this.messages.push(msg);
  }

  /**
   * Insert a message just before the current turn's user message.
   * Used for turn-local system notices (e.g. token scan) that must precede
   * the user prompt in the LLM's view.
   */
  insertBeforeCurrentTurn(msg: LLMMessage): void {
    const turnStart = this.findCurrentTurnStart();
    if (turnStart < 0) {
      this.messages.unshift(msg);
      return;
    }
    this.messages.splice(turnStart, 0, msg);
  }

  /**
   * Live reference to the full journal.
   * Hooks use this to inspect the in-flight state (read-only contract,
   * but the array itself is live so appends here are visible).
   */
  getMessages(): LLMMessage[] {
    return this.messages;
  }

  /** Messages belonging to the current turn (from last user message onward). */
  getCurrentTurnMessages(): LLMMessage[] {
    const turnStart = this.findCurrentTurnStart();
    if (turnStart < 0) return [];
    return this.messages.slice(turnStart);
  }

  // ─── Token tracking ─────────────────────────────────────────

  setLastPromptTokens(n: number): void {
    this.lastPromptTokens = n;
  }

  getLastPromptTokens(): number {
    return this.lastPromptTokens;
  }

  // ─── Diagnostics ────────────────────────────────────────────

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  estimateContextChars(): number {
    let total = this.systemPrompt.length;
    for (const msg of this.messages) total += this.estimateMessageChars(msg);
    return total;
  }

  /**
   * Per-layer chars, message counts, and full content for telemetry.
   * The flat journal is split back into the legacy 4-layer shape so the
   * dashboard's visualizer can render the same stacked bar.
   */
  getLayerBreakdown(includeStaticContent = true): ContextLayerBreakdown {
    const serializeMsg = (msg: LLMMessage): ContextLayerMessagePreview => {
      const chars = this.estimateMessageChars(msg);
      let content: string;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const parts: string[] = [];
        for (const p of msg.content as ContentBlock[]) {
          if (p.type === 'text') parts.push(p.text);
          if (p.type === 'tool_call') parts.push(`[call] ${p.name}(${JSON.stringify(p.input)})`);
          if (p.type === 'tool_result') parts.push(`[result] ${p.name}: ${JSON.stringify(p.data)}`);
        }
        content = parts.join('\n');
      } else {
        content = '';
      }
      return { id: msg.id || '', role: msg.role, chars, preview: content };
    };

    const turnStart = this.findCurrentTurnStart();
    const summaryMsg = this.messages[0] && isSummaryMessage(this.messages[0]) ? this.messages[0] : null;
    const historyStart = summaryMsg ? 1 : 0;
    const historyEnd = turnStart < 0 ? this.messages.length : turnStart;

    const historyMessages = this.messages.slice(historyStart, historyEnd);
    const turnMessages = turnStart < 0 ? [] : this.messages.slice(turnStart);

    const sumChars = (msgs: LLMMessage[]) =>
      msgs.reduce((acc, m) => acc + this.estimateMessageChars(m), 0);

    const summaryChars = summaryMsg ? this.estimateMessageChars(summaryMsg) : 0;

    return {
      systemPrompt: {
        chars: this.systemPrompt.length,
        msgs: this.systemPrompt ? 1 : 0,
        messages: this.systemPrompt
          ? [{ id: 'sys_static', role: 'system', chars: this.systemPrompt.length,
               preview: includeStaticContent ? this.systemPrompt : '(see iteration 1)' }]
          : [],
      },
      summary: {
        chars: summaryChars,
        msgs: summaryMsg ? 1 : 0,
        messages: summaryMsg ? [serializeMsg(summaryMsg)] : [],
      },
      conversationHistory: {
        chars: sumChars(historyMessages),
        msgs: historyMessages.length,
        messages: historyMessages.map(serializeMsg),
      },
      turnMessages: {
        chars: sumChars(turnMessages),
        msgs: turnMessages.length,
        messages: turnMessages.map(serializeMsg),
      },
    };
  }

  // ─── Turn boundary detection ────────────────────────────────

  private findCurrentTurnStart(): number {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === 'user' && !isSummaryMessage(msg)) return i;
    }
    return -1;
  }

  // ─── Compression ────────────────────────────────────────────

  /**
   * Lazy eviction: while over budget, peel the oldest pre-current-turn
   * messages, summarize them, and splice a single summary message at the
   * head (merging with any existing summary).
   */
  private async compressIfNeeded(): Promise<void> {
    const totalBefore = this.estimateContextChars();
    if (totalBefore <= this.contextBudgetChars) {
      console.log(`[Context] Lazy: ${totalBefore} chars, budget ${this.contextBudgetChars} — no compression needed`);
      return;
    }

    console.log(`[Context] Lazy: ${totalBefore} chars exceeds budget ${this.contextBudgetChars} — compressing oldest messages`);
    let compressions = 0;

    while (this.estimateContextChars() > this.contextBudgetChars) {
      const evicted = this.extractOldestTurnMessages();
      if (evicted.length === 0) break;

      const turnSummary = await buildCompressionSummary(this.provider, evicted);
      if (turnSummary) {
        this.mergeIntoSummary(turnSummary);
        compressions++;
      }
    }

    const maxChars = getContextProfile().summaryMaxChars;
    if (maxChars > 0) {
      const summary = this.messages[0];
      if (summary && isSummaryMessage(summary) && typeof summary.content === 'string') {
        const prefix = 'Previous conversation summary: ';
        const body = summary.content.startsWith(prefix) ? summary.content.slice(prefix.length) : summary.content;
        if (body.length > maxChars) {
          summary.content = prefix + capSummary(body, maxChars);
        }
      }
    }

    const totalAfter = this.estimateContextChars();
    console.log(`[Context] Compressed ${compressions} turn(s): ${totalBefore} → ${totalAfter} chars`);
  }

  /**
   * Splice a turn summary onto the head summary message. If none exists,
   * create one. The summary message is never part of "the current turn" —
   * it lives at index 0 (after any preceding one it's replacing).
   */
  private mergeIntoSummary(turnSummary: string): void {
    const head = this.messages[0];
    if (head && isSummaryMessage(head) && typeof head.content === 'string') {
      head.content = `${head.content}\n${turnSummary}`;
      return;
    }
    this.messages.unshift(makeSummaryMessage(turnSummary));
  }

  /**
   * Peel the oldest non-summary "turn" from the journal.
   * A turn = a user message + all following model/tool messages up to (but
   * excluding) the next user message, OR the tail if this is the only turn.
   *
   * Never evicts the current turn — that's the one the LLM is actively in.
   */
  private extractOldestTurnMessages(): LLMMessage[] {
    const currentTurnStart = this.findCurrentTurnStart();
    if (currentTurnStart < 0) return [];

    const startIdx = this.messages[0] && isSummaryMessage(this.messages[0]) ? 1 : 0;
    if (startIdx >= currentTurnStart) return [];

    let endIdx = currentTurnStart;
    for (let i = startIdx + 1; i < currentTurnStart; i++) {
      if (this.messages[i].role === 'user' && !isSummaryMessage(this.messages[i])) {
        endIdx = i;
        break;
      }
    }

    return this.messages.splice(startIdx, endIdx - startIdx);
  }

  // ─── Intra-turn budget gate ─────────────────────────────────

  private compressTurnIfOverBudget(): void {
    const totalChars = this.estimateContextChars();
    if (totalChars <= this.contextBudgetChars) return;

    const turnStart = this.findCurrentTurnStart();
    if (turnStart < 0) return;

    const modelIndices: number[] = [];
    for (let i = turnStart; i < this.messages.length; i++) {
      const msg = this.messages[i];
      if (msg.role === 'model' && this.hasFunctionCalls(msg)) modelIndices.push(i);
    }

    if (modelIndices.length < 2) return;

    let compressed = 0;
    for (let k = 0; k < modelIndices.length - 1; k++) {
      if (this.compressModelMessage(this.messages[modelIndices[k]])) compressed++;
    }

    if (compressed > 0) {
      const afterChars = this.estimateContextChars();
      console.log(`[Context] Budget gate: compressed ${compressed} model msg(s) functionCall args: ${totalChars} → ${afterChars} chars (budget: ${this.contextBudgetChars})`);
    }
  }

  private hasFunctionCalls(msg: LLMMessage): boolean {
    if (!Array.isArray(msg.content)) return false;
    return (msg.content as ContentBlock[]).some(b => b.type === 'tool_call');
  }

  private compressModelMessage(msg: LLMMessage): boolean {
    if (!Array.isArray(msg.content)) return false;
    let didCompress = false;

    for (let i = 0; i < (msg.content as ContentBlock[]).length; i++) {
      const block = (msg.content as ContentBlock[])[i];
      if (block.type !== 'tool_call') continue;
      const input = block.input;
      if (!input || (input as any)._compressed) continue;

      const name = block.name || '?';
      const inputStr = JSON.stringify(input);
      const summary = inputStr.length > 200
        ? `${name}: ${inputStr.length} chars (compressed)`
        : undefined;

      if (!summary) continue;

      (msg.content as ContentBlock[])[i] = {
        type: 'tool_call',
        id: block.id,
        name: block.name,
        input: { _compressed: true, summary },
        thoughtSignature: block.thoughtSignature,
      };
      didCompress = true;
    }

    for (let i = 0; i < (msg.content as ContentBlock[]).length; i++) {
      const block = (msg.content as ContentBlock[])[i];
      if (block.type === 'text' && block.text.length > 500) {
        (msg.content as ContentBlock[])[i] = { type: 'text', text: block.text.slice(0, 200) + '…(compressed)' };
        didCompress = true;
      }
    }

    return didCompress;
  }

  private estimateMessageChars(msg: LLMMessage): number {
    if (typeof msg.content === 'string') return msg.content.length;
    if (!Array.isArray(msg.content)) return 0;
    let total = 0;
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === 'text') {
        total += block.text.length;
      } else if (block.type === 'tool_call') {
        total += (block.name?.length || 0) + JSON.stringify(block.input || {}).length;
      } else if (block.type === 'tool_result') {
        total += (block.name?.length || 0) + JSON.stringify(block.data || {}).length;
      }
    }
    return total;
  }
}
