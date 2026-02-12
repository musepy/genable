/**
 * @file contextManager.ts
 * @description Manages message history, token estimation, and context compression rules.
 */

import { LLMMessage } from '../../llm-client/providers/types';
import { CONTEXT_CONSTANTS } from './constants';
import { estimateTokens } from './tokenEstimator';

export interface Turn {
  id: string; // The ID of the user message that started the turn
  indices: number[];
  tokens: number;
}

export class ContextManager {
  private messages: LLMMessage[] = [];
  private maxContextTokens: number;
  private approximateTokens: number = 0;

  constructor(maxContextTokens: number, initialMessages: LLMMessage[] = []) {
    this.maxContextTokens = maxContextTokens;
    this.messages = [...initialMessages];
    this.updateTokens();
  }

  public addMessage(message: LLMMessage): void {
    this.messages.push(message);
    this.updateTokens();
  }

  public getMessages(includeHidden = false): LLMMessage[] {
    return includeHidden ? this.messages : this.messages.filter(m => !m.hidden);
  }

  public getAllMessages(): LLMMessage[] {
    return this.messages;
  }

  public getApproximateTokens(): number {
    return this.approximateTokens;
  }

  public updateTokens(): void {
    this.approximateTokens = estimateTokens(this.getMessages());
  }

  /**
   * Main context governance loop.
   */
  public async manageContext(summarizer?: (messages: LLMMessage[]) => Promise<string>): Promise<void> {
    // 1. Drop redundant error messages
    this.dropRedundantToolErrors();

    this.updateTokens();

    if (this.approximateTokens <= this.maxContextTokens * CONTEXT_CONSTANTS.CONTEXT_COMPRESSION_LIMIT_FACTOR) {
      return;
    }

    // 2. Turn-based truncation
    this.truncateByTurns();

    // 3. Validate sequence
    const validation = this.validateMessageSequence(this.messages);
    if (!validation.valid) {
      console.warn('[ContextManager] Invalid sequence after truncation, fixing...', validation.error);
      this.fixInvalidSequence();
    }

    // 4. Proactive summarization if still over budget (if summarizer provided)
    if (this.approximateTokens > this.maxContextTokens && summarizer) {
      await this.summarizeConversation(summarizer);
    }
  }

  private dropRedundantToolErrors(): void {
    const visibleMessages = this.getMessages();
    const successfulTools = new Set<string>();

    // Scan backwards for successful tools
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.hidden || msg.role !== 'tool' || !Array.isArray(msg.content)) continue;

      const results = msg.content as any[];
      const isSuccess = results.every(r => r.functionResponse?.response?.success !== false);
      if (isSuccess) {
        results.forEach(r => successfulTools.add(r.functionResponse?.name));
      } else {
        const allFixed = results.every(r => successfulTools.has(r.functionResponse?.name));
        if (allFixed && visibleMessages.length > CONTEXT_CONSTANTS.REDUNDANT_ERROR_DROP_THRESHOLD) {
           msg.hidden = true;
           continue;
        }
      }
    }
  }

  private truncateByTurns(): void {
    const minTurnsToKeep = CONTEXT_CONSTANTS.MIN_TURNS_TO_KEEP;
    let tokensToHide = this.approximateTokens - (this.maxContextTokens * CONTEXT_CONSTANTS.CONTEXT_COMPRESSION_LIMIT_FACTOR);
    
    if (tokensToHide <= 0) return;

    const turns = this.groupIntoTurns(this.messages);
    if (turns.length <= minTurnsToKeep) return;

    let hiddenCount = 0;
    for (let i = 0; i < turns.length - minTurnsToKeep; i++) {
      if (tokensToHide <= 0) break;
      const turn = turns[i];
      for (const idx of turn.indices) {
        if (this.messages[idx].pinned) continue;
        this.messages[idx].hidden = true;
        hiddenCount++;
      }
      tokensToHide -= turn.tokens;
    }

    if (hiddenCount > 0) {
      this.updateTokens();
      console.log(`[ContextManager] Truncated ${hiddenCount} messages. New token count: ${this.approximateTokens}`);
    }
  }

  private fixInvalidSequence(): void {
    let fixed = false;

    // Strategy 1: Ensure tool responses are visible for visible model calls
    for (let msgIdx = 0; msgIdx < this.messages.length; msgIdx++) {
      const msg = this.messages[msgIdx];
      if (msg.hidden || msg.role !== 'model' || !this.hasFunctionCalls(msg)) continue;

      let hasToolResponse = false;
      for (let j = msgIdx + 1; j < this.messages.length; j++) {
        if (this.messages[j].role === 'system') continue;
        if (this.messages[j].hidden && this.messages[j].role === 'tool') {
          this.messages[j].hidden = false;
          hasToolResponse = true;
          fixed = true;
        } else if (!this.messages[j].hidden && this.messages[j].role === 'tool') {
          hasToolResponse = true;
        }
        if (this.messages[j].role !== 'tool' && this.messages[j].role !== 'system') break;
      }

      if (!hasToolResponse) {
        msg.hidden = true;
        fixed = true;
      }
    }

    // Strategy 2: Ensure sequence starts with user message after system
    const firstVisibleIdx = this.messages.findIndex(m => !m.hidden && m.role !== 'system');
    if (firstVisibleIdx !== -1 && this.messages[firstVisibleIdx].role !== 'user') {
      for (let i = firstVisibleIdx - 1; i >= 0; i--) {
        if (this.messages[i].role === 'system') continue;
        this.messages[i].hidden = false;
        fixed = true;
        if (this.messages[i].role === 'user') break;
      }
    }

    if (fixed) this.updateTokens();
  }

  private async summarizeConversation(summarizer: (messages: LLMMessage[]) => Promise<string>): Promise<void> {
    const turns = this.groupIntoTurns(this.messages);
    if (turns.length < 4) return;

    const turnsToSummarize = turns.slice(0, Math.floor(turns.length / 2));
    const allIndicesToHide: number[] = [];
    for (const turn of turnsToSummarize) {
      allIndicesToHide.push(...turn.indices);
    }

    if (allIndicesToHide.length === 0) return;

    const messagesToSummarize = allIndicesToHide.map(idx => this.messages[idx]);
    const summaryText = await summarizer(messagesToSummarize);
    
    allIndicesToHide.forEach(idx => {
      this.messages[idx].hidden = true;
    });

    const firstHiddenIdx = this.messages.findIndex(m => m.hidden && m.role !== 'system' && !m.summaryOf);
    const insertIdx = firstHiddenIdx !== -1 ? firstHiddenIdx : (this.messages[0]?.role === 'system' ? 1 : 0);

    const summaryMessage: LLMMessage = {
      id: `summary-${Date.now()}`,
      role: 'user',
      content: `[CONTEXT SUMMARY]: ${summaryText}`,
      summaryOf: messagesToSummarize.map(m => m.id),
      pinned: true
    };

    this.messages.splice(insertIdx, 0, summaryMessage);
    this.updateTokens();
  }

  public groupIntoTurns(messages: LLMMessage[]): Turn[] {
    const turns: Turn[] = [];
    let currentTurn: Turn | null = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.hidden || msg.role === 'system') continue;

      if (msg.role === 'user' && !msg.summaryOf) {
        if (currentTurn) turns.push(currentTurn);
        currentTurn = { id: msg.id, indices: [i], tokens: estimateTokens([msg]) };
      } else if (currentTurn) {
        currentTurn.indices.push(i);
        currentTurn.tokens += estimateTokens([msg]);
      }
    }

    if (currentTurn) turns.push(currentTurn);
    return turns;
  }

  private validateMessageSequence(messages: LLMMessage[]): { valid: boolean; error?: string } {
    const visible = messages.filter(m => !m.hidden);
    if (visible.length === 0) return { valid: true };

    let lastRole: string | null = null;
    for (let i = 0; i < visible.length; i++) {
      const m = visible[i];
      if (m.role === 'system') {
        if (i !== 0) return { valid: false, error: 'System message must be first' };
        continue;
      }
      
      if (lastRole === 'model') {
        if (m.role !== 'tool' && m.role !== 'user') return { valid: false, error: 'Model message must be followed by tool or user' };
      } else if (lastRole === 'tool') {
        if (m.role !== 'tool' && m.role !== 'model') return { valid: false, error: 'Tool message must be followed by tool or model' };
      } else if (lastRole === 'user') {
        if (m.role !== 'model') return { valid: false, error: 'User message must be followed by model' };
      } else if (lastRole === null) {
        if (m.role !== 'user') return { valid: false, error: 'First non-system message must be user' };
      }
      lastRole = m.role;
    }
    return { valid: true };
  }

  private hasFunctionCalls(msg: LLMMessage): boolean {
    if (msg.role !== 'model') return false;
    if (Array.isArray(msg.content)) {
      return msg.content.some((p: any) => p.functionCall);
    }
    return false;
  }
}
