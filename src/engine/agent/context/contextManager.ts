/**
 * @file contextManager.ts
 * @description Manages the 4-layer context for the agent runtime.
 *
 * Extracted from AgentRuntime to separate context management from loop orchestration.
 * Layers:
 *   1. systemPrompt          — static, set once at construction
 *   2. summary               — compressed history (only populated when context is near-full)
 *   3. conversationHistory   — previous turns' FULL messages (kept as long as context allows)
 *   4. turnMessages          — current turn's messages, moved to history at turn end
 *
 * Lazy compression: full messages are preserved across turns. Only when the total
 * context approaches the model's context window are the oldest turns compressed
 * into the summary.
 */

import { LLMMessage, Part } from '../../llm-client/providers/types';
import { buildCompressionSummary, capSummary } from './contextSummarizer';
import { compressConsumedToolResults } from './turnResultCompressor';
import { getContextProfile } from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextManagerOptions {
  systemPrompt: string;
  contextBudgetChars: number;
}

// ---------------------------------------------------------------------------
// ContextManager
// ---------------------------------------------------------------------------

export class ContextManager {
  // ─── State ───
  private readonly systemPrompt: string;
  private summary: string = '';
  private conversationHistory: LLMMessage[] = [];
  private turnMessages: LLMMessage[] = [];
  private readonly contextBudgetChars: number;
  private lastPromptTokens: number = 0;

  constructor(opts: ContextManagerOptions) {
    this.systemPrompt = opts.systemPrompt;
    this.contextBudgetChars = opts.contextBudgetChars;
  }

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Assemble the prompt from 4-layer context.
   * Layers: system → summary (compressed) → conversation history (full) → current turn.
   *
   * Includes an intra-turn budget gate: if the current turn has grown beyond
   * the context budget, older model+tool message pairs are compressed in-place
   * before assembling. This prevents unbounded context growth within a single
   * turn (e.g. 18 JSX iterations accumulating ~126K chars of functionCall args).
   */
  assemblePrompt(): LLMMessage[] {
    // ── Intra-turn budget gate ──
    // Compress oldest consumed model+tool pairs when context exceeds budget.
    // This is the "fail fast" defense — prevent sending over-budget prompts to the LLM.
    this.compressTurnIfOverBudget();

    const messages: LLMMessage[] = [];

    // Layer 1: static system prompt
    if (this.systemPrompt) {
      messages.push({ id: 'sys_static', role: 'system', content: this.systemPrompt });
    }

    // Layer 2: compressed summary (only present if some history was compressed)
    if (this.summary) {
      messages.push({ id: 'ctx_summary', role: 'system', content: this.summary });
    }

    // Layer 3: uncompressed conversation history (previous turns, full detail)
    messages.push(...this.conversationHistory);

    // Layer 4: current turn messages
    messages.push(...this.turnMessages);

    return messages;
  }

  /**
   * End the current turn. Moves turnMessages to conversationHistory (preserving
   * full detail), then lazily compresses only if approaching context budget.
   *
   * turnMessages are NOT cleared here — they stay available for getTurnMessages()
   * (used by debrief). They're cleared at the start of the next startTurn().
   */
  endTurn(): void {
    this.conversationHistory.push(...this.turnMessages);
    this.compressIfNeeded();
  }

  /**
   * Start a new turn. Clears turnMessages (already moved to conversationHistory
   * by endTurn).
   */
  startTurn(): void {
    this.turnMessages = [];
  }

  /** Whether this is the first turn (no previous conversation history). */
  isFirstTurn(): boolean {
    return this.conversationHistory.length === 0;
  }

  // ─── Message operations ─────────────────────────────────────

  pushToTurn(msg: LLMMessage): void {
    this.turnMessages.push(msg);
  }

  unshiftToTurn(msg: LLMMessage): void {
    this.turnMessages.unshift(msg);
  }

  /**
   * Returns the live turnMessages array reference.
   * Hooks depend on this being a live reference — they push injectMessage directly.
   */
  getTurnMessages(): LLMMessage[] {
    return this.turnMessages;
  }

  /** Read-only access to conversation history (for subtask etc.). */
  getConversationHistory(): LLMMessage[] {
    return this.conversationHistory;
  }

  // ─── Compression ────────────────────────────────────────────

  /** Compress consumed tool results in current turn. Returns count of compressed results. */
  compressConsumedResults(): number {
    return compressConsumedToolResults(this.turnMessages);
  }

  /**
   * Intra-turn budget gate: compress oldest consumed model+tool message pairs
   * when the total context exceeds the budget.
   *
   * Unlike compressConsumedResults (which only touches functionResponse),
   * this also compresses model messages' functionCall args — the main source
   * of unbounded growth (each JSX call is ~7K chars).
   *
   * Strategy: find consumed model+tool pairs (all except the latest pair)
   * and replace functionCall args with a one-line summary.
   */
  private compressTurnIfOverBudget(): void {
    const totalChars = this.estimateContextChars();
    if (totalChars <= this.contextBudgetChars) return;

    // Find model message indices that have functionCall parts
    const modelIndices: number[] = [];
    for (let i = 0; i < this.turnMessages.length; i++) {
      const msg = this.turnMessages[i];
      if (msg.role === 'model' && this.hasFunctionCalls(msg)) {
        modelIndices.push(i);
      }
    }

    // Keep the latest model message uncompressed (LLM needs it for continuity)
    if (modelIndices.length < 2) return;

    let compressed = 0;
    for (let k = 0; k < modelIndices.length - 1; k++) {
      if (this.compressModelMessage(this.turnMessages[modelIndices[k]])) {
        compressed++;
      }
    }

    if (compressed > 0) {
      const afterChars = this.estimateContextChars();
      console.log(`[Context] Budget gate: compressed ${compressed} model msg(s) functionCall args: ${totalChars} → ${afterChars} chars (budget: ${this.contextBudgetChars})`);
    }
  }

  /** Check if a message contains functionCall parts. */
  private hasFunctionCalls(msg: LLMMessage): boolean {
    if (!Array.isArray(msg.content)) return false;
    return (msg.content as Part[]).some(p => !!p.functionCall);
  }

  /**
   * Compress functionCall args in a model message to a one-line summary.
   * Preserves the tool name and call ID. Returns true if anything was compressed.
   */
  private compressModelMessage(msg: LLMMessage): boolean {
    if (!Array.isArray(msg.content)) return false;
    let didCompress = false;

    for (let i = 0; i < (msg.content as Part[]).length; i++) {
      const part = (msg.content as Part[])[i];
      if (!part.functionCall) continue;
      const args = part.functionCall.args;
      if (!args || (args as any)._compressed) continue;

      // Build a one-line summary of args
      const name = part.functionCall.name || '?';
      const argsStr = JSON.stringify(args);
      const summary = argsStr.length > 200
        ? `${name}: ${argsStr.length} chars (compressed)`
        : undefined;

      if (!summary) continue; // small args, not worth compressing

      (msg.content as Part[])[i] = {
        ...part,
        functionCall: {
          ...part.functionCall,
          args: { _compressed: true, summary },
        },
      };
      didCompress = true;
    }

    // Also compress any text/thoughts in the model message (thinking tokens)
    for (let i = 0; i < (msg.content as Part[]).length; i++) {
      const part = (msg.content as Part[])[i];
      if (part.text && part.text.length > 500) {
        (msg.content as Part[])[i] = { ...part, text: part.text.slice(0, 200) + '…(compressed)' };
        didCompress = true;
      }
    }

    return didCompress;
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

  /** Estimate total context size in chars (across all 4 layers). */
  estimateContextChars(): number {
    let total = this.systemPrompt.length + this.summary.length;
    for (const msg of this.conversationHistory) {
      total += this.estimateMessageChars(msg);
    }
    for (const msg of this.turnMessages) {
      total += this.estimateMessageChars(msg);
    }
    return total;
  }

  /** Per-layer chars, message counts, and full content for diagnostics.
   *  systemPrompt: only included when `includeStaticContent` is true (first call),
   *  since it's the same across iterations. */
  getLayerBreakdown(includeStaticContent = true) {
    const serializeMsg = (msg: LLMMessage) => {
      const chars = this.estimateMessageChars(msg);
      let content: string;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const parts: string[] = [];
        for (const p of msg.content as Part[]) {
          if (p.text) parts.push(p.text);
          if (p.functionCall) {
            parts.push(`[call] ${p.functionCall.name}(${JSON.stringify(p.functionCall.args)})`);
          }
          if (p.functionResponse) {
            parts.push(`[result] ${p.functionResponse.name}: ${JSON.stringify(p.functionResponse.response)}`);
          }
        }
        content = parts.join('\n');
      } else {
        content = '';
      }
      return { id: msg.id || '', role: msg.role, chars, preview: content };
    };

    let historyChars = 0;
    const historyMsgs = this.conversationHistory.map(m => {
      historyChars += this.estimateMessageChars(m);
      return serializeMsg(m);
    });
    let turnChars = 0;
    const turnMsgs = this.turnMessages.map(m => {
      turnChars += this.estimateMessageChars(m);
      return serializeMsg(m);
    });

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
        chars: this.summary.length,
        msgs: this.summary ? 1 : 0,
        messages: this.summary
          ? [{ id: 'ctx_summary', role: 'system', chars: this.summary.length, preview: this.summary }]
          : [],
      },
      conversationHistory: { chars: historyChars, msgs: this.conversationHistory.length, messages: historyMsgs },
      turnMessages: { chars: turnChars, msgs: this.turnMessages.length, messages: turnMsgs },
    };
  }

  // ─── Private ────────────────────────────────────────────────

  /**
   * Compress oldest turns from conversationHistory into summary,
   * but ONLY if total context exceeds the budget.
   */
  private compressIfNeeded(): void {
    const totalBefore = this.estimateContextChars();
    if (totalBefore <= this.contextBudgetChars) {
      console.log(`[Context] Lazy: ${totalBefore} chars, budget ${this.contextBudgetChars} — no compression needed`);
      return;
    }

    console.log(`[Context] Lazy: ${totalBefore} chars exceeds budget ${this.contextBudgetChars} — compressing oldest turns`);
    let compressed = 0;

    while (this.estimateContextChars() > this.contextBudgetChars && this.conversationHistory.length > 0) {
      const oldestTurn = this.extractOldestTurn();
      if (oldestTurn.length === 0) break;

      const turnSummary = buildCompressionSummary(oldestTurn);
      if (turnSummary) {
        this.summary = this.summary
          ? `${this.summary}\n${turnSummary}`
          : turnSummary;
        compressed++;
      }
    }

    // Cap summary if it grew too large
    const maxChars = getContextProfile().summaryMaxChars;
    if (maxChars > 0 && this.summary.length > maxChars) {
      this.summary = capSummary(this.summary, maxChars);
    }

    const totalAfter = this.estimateContextChars();
    console.log(`[Context] Compressed ${compressed} turns: ${totalBefore} → ${totalAfter} chars (summary: ${this.summary.length} chars)`);
  }

  /**
   * Extract the oldest logical turn from conversationHistory.
   * A turn = a user message + all subsequent model/tool messages until the next user message.
   */
  private extractOldestTurn(): LLMMessage[] {
    if (this.conversationHistory.length === 0) return [];

    let endIdx = this.conversationHistory.length;
    for (let i = 1; i < this.conversationHistory.length; i++) {
      if (this.conversationHistory[i].role === 'user') {
        endIdx = i;
        break;
      }
    }

    return this.conversationHistory.splice(0, endIdx);
  }

  private estimateMessageChars(msg: LLMMessage): number {
    if (typeof msg.content === 'string') return msg.content.length;
    if (!Array.isArray(msg.content)) return 0;
    let total = 0;
    for (const part of msg.content as Part[]) {
      if (part.text) total += part.text.length;
      if (part.functionCall) {
        total += (part.functionCall.name?.length || 0)
          + JSON.stringify(part.functionCall.args || {}).length;
      }
      if (part.functionResponse) {
        total += (part.functionResponse.name?.length || 0)
          + JSON.stringify(part.functionResponse.response || {}).length;
      }
    }
    return total;
  }
}
