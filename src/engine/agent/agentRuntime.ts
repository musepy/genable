/**
 * @file agentRuntime.ts
 * @description Core runtime for the agentic loop. Orchestrates LLM calls and tool execution.
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMToolCall, Part } from '../llm-client/providers/types';
import { ToolDefinition, ToolParameter, getToolsForMode } from './tools';
import { IpcBridge } from './ipcBridge';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { RetryPolicy, AgentErrorCategory } from './retryPolicy';
import { DEFAULT_THINKING_LEVEL } from '../llm-client/config';
import { planState } from './planState';
import { AgentMode, composeAgentSystemPrompt } from '../llm-client/context/promptComposer';
import { mapToSemanticError, formatSemanticError } from '../utils/errorUtils';

export interface AgentRuntimeOptions {
  provider: LLMProvider;
  tools: ToolDefinition[];
  ipcBridge?: IpcBridge; // Optional to allow for extensive mocking or local-only modes
  maxIterations?: number;
  maxContextTokens?: number; // Max tokens before context compression
  systemPrompt?: string;
  planId?: string; // Optional ID for persistent planning
  onIteration?: (iteration: number, response: LLMResponse, taskInfo?: { taskId: string, taskTitle: string }) => void;
  onToolCall?: (toolCall: LLMToolCall) => void;
  onToolResult?: (toolCall: LLMToolCall, result: any) => void;
  onProgress?: (chunk: string) => void;
  onThinking?: (thought: string) => void;
  onIterationStart?: (iteration: number, taskInfo?: { taskId: string, taskTitle: string }) => void;
  toolExecutors?: Record<string, import('./tools/types').ToolExecutor>;
}

export class AgentRuntime {
  private messages: LLMMessage[] = [];
  private maxIterations: number;
  private maxContextTokens: number;
  private approximateTokens: number = 0;
  private retryPolicy: RetryPolicy;
  private idCounter: number = 0;
  private lastThinkingText: string = '';
  private toolCallSignatureHistory: string[] = [];
  private thinkingOnlyIterations: number = 0;
  private anyModeRetryCount: number = 0;
  private lastNotificationTime: number = 0;
  private readonly THROTTLE_MS = 100;
  private lastProgressSummary: string = '';
  private identicalSummaryCount: number = 0;
  private progressCallCount: number = 0;
  private lastProgressHeaders: string[] = [];
  private hasPendingToolErrors: boolean = false;
  private collectionAttempts: number = 0; // 🔴 P1: Collection counter
  private staleStepIterations: number = 0; // Track how long a step has been active without advancing
  private lastActiveStepId: string | null = null; // Track which step was active last iteration
  private readonly STALE_STEP_THRESHOLD = 15; // Force step completion after this many iterations
  private readonly AUTO_BATCH_TOOL_NAMES = new Set([
    'createNode',
    'setNodeLayout',
    'setNodeStyles',
    'updateNodeProperties',
    'createIcon',
    'deleteNode',
    'applyDesignPatch'
  ]);

  constructor(private options: AgentRuntimeOptions) {
    this.retryPolicy = new RetryPolicy();
    this.maxIterations = options.maxIterations || AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_ITERATIONS;
    // FIX: Limit context to prevent MALFORMED_FUNCTION_CALL from excessive prompt size
    this.maxContextTokens = options.maxContextTokens || AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_CONTEXT_TOKENS;
    
    // Disable throttling in tests
    if (process.env.NODE_ENV === 'test') {
      (this as any).THROTTLE_MS = 0;
    }
  }

  /**
   * Token estimation with Chinese character support.
   */
  private estimateTokens(content: string | any[]): number {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    
    // Improved estimation: count Chinese characters separately
    // 1 Chinese char ≈ 0.6 tokens (approx empirical value for Gemini)
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    
    const chineseTokens = Math.ceil(chineseChars * AGENT_RUNTIME_CONSTANTS.ESTIMATION_CHINESE_CHAR_MULTIPLIER);
    const otherTokens = Math.ceil(otherChars / AGENT_RUNTIME_CONSTANTS.ESTIMATION_CHARACTERS_PER_TOKEN);
    
    return chineseTokens + otherTokens;
  }

  /**
   * Generates a unique ID with prefix, timestamp, random, and counter.
   */
  private generateId(prefix: string): string {
    this.idCounter++;
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 5);
    return `${prefix}_${timestamp}${random}${this.idCounter}`;
  }

  /**
   * Stable short hash for loop-signature fingerprinting.
   */
  private hashString(value: string): string {
    if (!value) return '0';
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private sanitizeOpId(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
  }

  private sanitizeString(value: any, maxLength = 200): string {
    const text = String(value ?? '');
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '…';
  }

  private sanitizeArgsBySchema(value: any, schema?: ToolParameter, depth = 0): any {
    if (value === null || value === undefined || !schema) return value;

    switch (schema.type) {
      case 'string':
        return this.sanitizeString(value);
      case 'number':
      case 'boolean':
        return value;
      case 'array': {
        if (!Array.isArray(value)) return [];
        const sliced = value.slice(0, 20);
        if (!schema.items) return sliced;
        return sliced.map(item => this.sanitizeArgsBySchema(item, schema.items, depth + 1));
      }
      case 'object': {
        if (typeof value !== 'object') return {};
        const props = schema.properties || {};
        const keys = Object.keys(props);
        if (keys.length === 0) {
          const out: Record<string, any> = {};
          const entries = Object.entries(value).slice(0, 10);
          for (const [key, val] of entries) {
            if (val === null || val === undefined) continue;
            if (typeof val === 'string') out[key] = this.sanitizeString(val, 120);
            else if (typeof val === 'number' || typeof val === 'boolean') out[key] = val;
            else if (Array.isArray(val)) out[key] = `[${val.length} items]`;
            else if (typeof val === 'object') out[key] = '{…}';
          }
          return out;
        }

        const out: Record<string, any> = {};
        for (const key of keys) {
          if (value[key] === undefined) continue;
          out[key] = this.sanitizeArgsBySchema(value[key], props[key], depth + 1);
        }
        return out;
      }
      default:
        return value;
    }
  }

  /**
   * Max chars for a single tool call's args when stored in history.
   * ~750 tokens. Prevents batchOperations with deep children from bloating context.
   */
  private readonly MAX_HISTORY_ARGS_CHARS = 3000;

  private sanitizeToolCallsForHistory(toolCalls: LLMToolCall[]): LLMToolCall[] {
    const toolMap = new Map(this.options.tools.map(tool => [tool.name, tool]));

    return toolCalls.map(tc => {
      const def = toolMap.get(tc.name);
      if (!def) return tc;
      let sanitizedArgs = this.sanitizeArgsBySchema(tc.args, def.parameters as ToolParameter);

      // Hard cap: truncate oversized args to prevent context explosion.
      // batchOperations with recursive children or large inline styles can produce 30-50K chars.
      const argsJson = JSON.stringify(sanitizedArgs);
      if (argsJson.length > this.MAX_HISTORY_ARGS_CHARS) {
        if (tc.name === 'batchOperations' && Array.isArray(sanitizedArgs.operations)) {
          // Keep skeleton: opId + action + essential refs, drop bloated params
          sanitizedArgs = {
            operations: sanitizedArgs.operations.map((op: any) => ({
              opId: op.opId,
              action: op.action,
              _paramsTruncated: true,
              // Keep references for dependency tracking across history
              ...(op.params?.nodeRef && { nodeRef: op.params.nodeRef }),
              ...(op.params?.parentRef && { parentRef: op.params.parentRef }),
              ...(op.params?.nodeId && { nodeId: op.params.nodeId }),
              ...(op.params?.parentId && { parentId: op.params.parentId }),
              ...(op.params?.name && { name: op.params.name }),
              // Keep opIds of children for hierarchy tracing
              ...(Array.isArray(op.params?.children) && {
                childOpIds: op.params.children.map((c: any) => c.opId).filter(Boolean)
              }),
            })),
            strategy: sanitizedArgs.strategy,
            onError: sanitizedArgs.onError,
            _truncated: true,
            _originalSize: argsJson.length
          };
        } else if (tc.name === 'applyDesignPatch' && Array.isArray(sanitizedArgs.patches)) {
          // Keep patch targets, drop detailed style values
          sanitizedArgs = {
            patches: sanitizedArgs.patches.map((p: any) => ({
              nodeId: p.nodeId || p.nodeRef,
              _hasLayout: !!p.layout,
              _hasStyles: !!p.styles,
              _hasProperties: !!p.properties,
            })),
            _truncated: true,
            _originalSize: argsJson.length
          };
        } else {
          // Generic truncation: keep tool name context only
          sanitizedArgs = {
            _truncated: true,
            _tool: tc.name,
            _originalSize: argsJson.length,
            // Keep nodeId if present for reference
            ...(sanitizedArgs.nodeId && { nodeId: sanitizedArgs.nodeId }),
            ...(sanitizedArgs.name && { name: sanitizedArgs.name }),
          };
        }
        console.log(`[AgentRuntime] ✂️ Truncated ${tc.name} args for history: ${argsJson.length} -> ${JSON.stringify(sanitizedArgs).length} chars`);
      }

      return { ...tc, args: sanitizedArgs };
    });
  }

  private compactThoughtSignatures(): void {
    let lastToolIdx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.hidden || msg.role !== 'tool') continue;
      if (Array.isArray(msg.content) && msg.content.some((p: any) => p.functionResponse)) {
        lastToolIdx = i;
        break;
      }
    }

    const preserve = new Set<number>();
    if (lastToolIdx !== -1) preserve.add(lastToolIdx);

    let mutated = false;
    for (let i = 0; i < this.messages.length; i++) {
      if (preserve.has(i)) continue;
      const msg = this.messages[i];
      if (msg.hidden) continue;
      if (msg.role !== 'tool') continue;
      if (!Array.isArray(msg.content)) continue;

      let changed = false;
      const cleaned = (msg.content as any[]).map(part => {
        if (!part || typeof part !== 'object') return part;
        const copy = { ...part } as any;
        if ('thought_signature' in copy) {
          delete copy.thought_signature;
          changed = true;
        }
        if ('thoughtSignature' in copy) {
          delete copy.thoughtSignature;
          changed = true;
        }
        return copy;
      });

      if (changed) {
        msg.content = cleaned;
        mutated = true;
      }
    }

    if (mutated) {
      this.approximateTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
      console.log(`[AgentRuntime] 🧽 Compacted thought signatures in tool history. Visible tokens: ${this.approximateTokens}`);
    }
  }

  private buildBatchOperationsCall(calls: LLMToolCall[]): LLMToolCall {
    const ops = calls.map((tc, index) => {
      const base =
        tc.args?.name ||
        tc.args?.iconName ||
        tc.args?.nodeId ||
        tc.args?.parentId ||
        tc.name;
      const safeBase = base ? this.sanitizeOpId(String(base)) : '';
      const opId = `${tc.name}_${safeBase || 'op'}_${index + 1}`;
      return {
        opId,
        action: tc.name,
        params: tc.args
      };
    });

    return {
      id: `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: 'batchOperations',
      args: {
        operations: ops,
        strategy: 'sequential',
        onError: 'skip-dependents'
      },
      thought_signature: calls[0]?.thought_signature
    };
  }

  private autoBatchToolCalls(toolCalls: LLMToolCall[], mode: AgentMode): LLMToolCall[] {
    if (mode !== 'EXECUTION') return toolCalls;
    if (!toolCalls || toolCalls.length < 2) return toolCalls;

    const batched: LLMToolCall[] = [];
    let buffer: LLMToolCall[] = [];

    const flush = () => {
      if (buffer.length >= 2) {
        batched.push(this.buildBatchOperationsCall(buffer));
      } else if (buffer.length === 1) {
        batched.push(buffer[0]);
      }
      buffer = [];
    };

    for (const tc of toolCalls) {
      if (this.AUTO_BATCH_TOOL_NAMES.has(tc.name)) {
        buffer.push(tc);
        continue;
      }
      flush();
      batched.push(tc);
    }

    flush();
    return batched;
  }

  /**
   * Check if a message contains function calls (tool calls)
   */
  private hasFunctionCalls(msg: LLMMessage): boolean {
    if (!Array.isArray(msg.content)) return false;
    return msg.content.some((part: any) => part.functionCall);
  }

  /**
   * Define a Turn structure for proper context management
   * A Turn represents a complete interaction: User -> Model -> Tool(s)
   */
  private groupIntoTurns(messages: LLMMessage[]): Array<{ indices: number[]; tokens: number }> {
    const turns: Array<{ indices: number[]; tokens: number }> = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];

      // Skip system messages and hidden messages
      if (msg.role === 'system' || msg.hidden) {
        i++;
        continue;
      }

      const turnIndices: number[] = [];

      if (msg.role === 'user') {
        // User-initiated turn: user → model → tool*
        turnIndices.push(i);
        i++;

        // Collect the model response
        if (i < messages.length && messages[i].role === 'model' && !messages[i].hidden) {
          turnIndices.push(i);
          const modelMsg = messages[i];

          // If model has function calls, collect all following tool responses
          if (this.hasFunctionCalls(modelMsg)) {
            i++;
            while (i < messages.length && messages[i].role === 'tool' && !messages[i].hidden) {
              turnIndices.push(i);
              i++;
            }
          } else {
            i++;
          }
        }

        // Calculate tokens for this turn
        const tokens = turnIndices.reduce((sum, idx) => {
          return sum + this.estimateTokens(messages[idx].content);
        }, 0);

        turns.push({ indices: turnIndices, tokens });
      } else if (msg.role === 'model') {
        // Model-initiated turn (agentic continuation): model → tool*
        // This happens in multi-step agent loops where model calls tools
        // without an intervening user message.
        turnIndices.push(i);

        if (this.hasFunctionCalls(msg)) {
          i++;
          while (i < messages.length && messages[i].role === 'tool' && !messages[i].hidden) {
            turnIndices.push(i);
            i++;
          }
        } else {
          i++;
        }

        const tokens = turnIndices.reduce((sum, idx) => {
          return sum + this.estimateTokens(messages[idx].content);
        }, 0);

        turns.push({ indices: turnIndices, tokens });
      } else {
        // Orphaned tool message without preceding model - group alone
        turnIndices.push(i);
        const tokens = this.estimateTokens(messages[i].content);
        turns.push({ indices: turnIndices, tokens });
        i++;
      }
    }

    return turns;
  }

  /**
   * Validate that the message sequence is valid for Gemini API
   * Rules:
   * 1. Must start with user message (or system then user)
   * 2. No orphaned tool responses (must follow a model function call)
   * 3. Model function calls must be followed by tool responses
   */
  private validateMessageSequence(messages: LLMMessage[]): { valid: boolean; error?: string } {
    const visibleMessages = messages.filter(m => !m.hidden && m.role !== 'system');
    
    if (visibleMessages.length === 0) {
      return { valid: true };
    }
    
    // Rule 1: Must start with user message
    if (visibleMessages[0].role !== 'user') {
      return { 
        valid: false, 
        error: `Sequence must start with user message, but starts with ${visibleMessages[0].role}` 
      };
    }
    
    // Rule 2 & 3: Check function call pairs
    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      
      if (msg.role === 'model' && this.hasFunctionCalls(msg)) {
        // Must have at least one tool response following
        let hasToolResponse = false;
        let j = i + 1;
        while (j < visibleMessages.length && visibleMessages[j].role === 'tool') {
          hasToolResponse = true;
          j++;
        }
        
        if (!hasToolResponse) {
          return { 
            valid: false, 
            error: `Model message at index ${i} has function calls but no tool responses follow` 
          };
        }
      }
      
      if (msg.role === 'tool') {
        // Must be preceded by a model message with function calls
        if (i === 0 || visibleMessages[i - 1].role !== 'model') {
          return { 
            valid: false, 
            error: `Tool message at index ${i} is orphaned (no preceding model message)` 
          };
        }
        
        const prevModel = visibleMessages[i - 1];
        if (!this.hasFunctionCalls(prevModel)) {
          return { 
            valid: false, 
            error: `Tool message at index ${i} follows model without function calls` 
          };
        }
      }
    }
    
    return { valid: true };
  }

  /**
   * Reversible context management using Turn-based truncation.
   * 
   * CRITICAL: Must preserve [User] -> [Model] -> [Tool] sequence integrity.
   * Uses proper turn-based logic to ensure no orphaned messages.
   */
  private async manageContext(): Promise<void> {
    // Validate current sequence before any modifications
    const validationBefore = this.validateMessageSequence(this.messages);
    if (!validationBefore.valid) {
      console.warn('[AgentRuntime] Message sequence invalid before truncation:', validationBefore.error);
    }

    const nonSystemVisibleMessages = this.messages.filter(m => m.role !== 'system' && !m.hidden);
    
    // SMART CLEANING: Remove redundant error turns (still useful for noise reduction)
    const successfulTools = new Set<string>();
    for (let i = nonSystemVisibleMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemVisibleMessages[i];
      if (msg.role === 'tool' && Array.isArray(msg.content)) {
        const results = msg.content as any[];
        const isSuccess = results.every(r => r.functionResponse?.response?.success !== false);
        if (isSuccess) {
          results.forEach(r => successfulTools.add(r.functionResponse?.name));
        } else {
          const allFixed = results.every(r => successfulTools.has(r.functionResponse?.name));
          if (allFixed && nonSystemVisibleMessages.length > AGENT_RUNTIME_CONSTANTS.REDUNDANT_ERROR_DROP_THRESHOLD) {
             msg.hidden = true; // REVERSIBILITY: Just hide
             continue;
          }
        }
      }
    }

    const currentVisibleTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
    // Always sync approximateTokens to actual visible context
    this.approximateTokens = currentVisibleTokens;

    if (currentVisibleTokens <= this.maxContextTokens * AGENT_RUNTIME_CONSTANTS.CONTEXT_COMPRESSION_LIMIT_FACTOR) {
      return;
    }

    // NEW: Use turn-based truncation
    await this.truncateByTurns();

    // Validate sequence after truncation
    const validationAfter = this.validateMessageSequence(this.messages);
    if (!validationAfter.valid) {
      console.error('[AgentRuntime] CRITICAL: Message sequence invalid after truncation:', validationAfter.error);
      // Attempt to fix by unhiding the most recent turn
      await this.fixInvalidSequence();
    }

    // [ROBUSTNESS]: If still over budget after truncation (due to large single messages), 
    // attempt summarization of the oldest visible blocks.
    if (this.approximateTokens > this.maxContextTokens) {
        await this.summarizeConversation().catch(err => {
            console.warn('[AgentRuntime] Summarization failed, falling back to pure truncation robustness.', err);
        });
    }
  }

  /**
   * Turn-based truncation: Hide oldest complete turns until budget is met.
   * This ensures we never have orphaned messages.
   */
  private async truncateByTurns(): Promise<void> {
    const minTurnsToKeep = 3; // Keep at least 3 complete turns
    const currentVisibleTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
    let tokensToHide = currentVisibleTokens - (this.maxContextTokens * AGENT_RUNTIME_CONSTANTS.CONTEXT_COMPRESSION_LIMIT_FACTOR);
    
    if (tokensToHide <= 0) return;

    // Group messages into turns
    const turns = this.groupIntoTurns(this.messages);
    
    if (turns.length <= minTurnsToKeep) {
      console.log(`[AgentRuntime] Not enough turns to truncate (${turns.length} <= ${minTurnsToKeep})`);
      return;
    }

    let hiddenCount = 0;
    let hiddenTokens = 0;

    // Hide oldest turns first
    for (let i = 0; i < turns.length - minTurnsToKeep; i++) {
      if (tokensToHide <= 0) break;
      
      const turn = turns[i];
      
      // Hide all messages in this turn
      for (const idx of turn.indices) {
        this.messages[idx].hidden = true;
        hiddenCount++;
      }
      
      hiddenTokens += turn.tokens;
      tokensToHide -= turn.tokens;
    }

    if (hiddenCount > 0) {
      console.log(`[AgentRuntime] Context managed via turn-based truncation: hid ${hiddenCount} messages (${hiddenTokens} tokens). Current visible tokens: ${this.estimateTokens(this.messages.filter(m => !m.hidden))}`);
      this.approximateTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
    }
  }

  /**
   * Attempt to fix an invalid sequence by unhiding messages
   */
  private async fixInvalidSequence(): Promise<void> {
    console.warn('[AgentRuntime] Attempting to fix invalid sequence...');

    // Strategy 1: For each visible model message with function calls,
    // ensure its tool responses are also visible.
    const visibleMessages = this.messages.filter(m => !m.hidden && m.role !== 'system');
    let fixed = false;

    for (let msgIdx = 0; msgIdx < this.messages.length; msgIdx++) {
      const msg = this.messages[msgIdx];
      if (msg.hidden || msg.role !== 'model' || !this.hasFunctionCalls(msg)) continue;

      // Check if next visible non-system message is a tool response
      let hasToolResponse = false;
      for (let j = msgIdx + 1; j < this.messages.length; j++) {
        if (this.messages[j].role === 'system') continue;
        if (this.messages[j].hidden && this.messages[j].role === 'tool') {
          // Unhide tool response that was orphaned by truncation
          this.messages[j].hidden = false;
          hasToolResponse = true;
          fixed = true;
          console.log(`[AgentRuntime] Unhid tool response at index ${j} to fix orphaned model+tools`);
        } else if (!this.messages[j].hidden && this.messages[j].role === 'tool') {
          hasToolResponse = true;
        }
        // Stop once we hit a non-tool message
        if (this.messages[j].role !== 'tool' && this.messages[j].role !== 'system') break;
      }

      // If no tool responses exist at all, hide the model message instead
      if (!hasToolResponse) {
        msg.hidden = true;
        fixed = true;
        console.log(`[AgentRuntime] Hid orphaned model message at index ${msgIdx} (no tool responses available)`);
      }
    }

    // Strategy 2: Ensure sequence starts with user message
    const firstVisibleIdx = this.messages.findIndex(m => !m.hidden && m.role !== 'system');
    if (firstVisibleIdx !== -1 && this.messages[firstVisibleIdx].role !== 'user') {
      for (let i = firstVisibleIdx - 1; i >= 0; i--) {
        if (this.messages[i].role === 'system') continue;
        this.messages[i].hidden = false;
        fixed = true;
        if (this.messages[i].role === 'user') {
          console.log(`[AgentRuntime] Unhid message at index ${i} to ensure sequence starts with user`);
          break;
        }
      }
    }

    // Re-sync token count after modifications
    if (fixed) {
      this.approximateTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
    }

    // Re-validate
    const validation = this.validateMessageSequence(this.messages);
    if (validation.valid) {
      console.log('[AgentRuntime] Sequence fixed successfully');
    } else {
      console.error('[AgentRuntime] Unable to fix sequence:', validation.error);
    }
  }

  /**
   * Summarizes a block of visible messages and replaces them with a single summary message.
   * Original messages are marked hidden instead of deleted (Strong Reversibility).
   * 
   * [FIX]: Uses turn-based grouping to ensure no orphaned messages.
   */
  private async summarizeConversation(): Promise<void> {
    const turns = this.groupIntoTurns(this.messages);
    if (turns.length < 4) return; // Not enough context to summarize effectively (keep at least 3 turns + 1 to summarize)

    // Summarize roughly half of the available turns
    const turnsToSummarize = turns.slice(0, Math.floor(turns.length / 2));
    const allIndicesToHide: number[] = [];
    const allIdsToSummarize: string[] = [];

    for (const turn of turnsToSummarize) {
      allIndicesToHide.push(...turn.indices);
      for (const idx of turn.indices) {
        allIdsToSummarize.push(this.messages[idx].id);
      }
    }

    if (allIndicesToHide.length === 0) return;

    try {
      const messagesToSummarize = allIndicesToHide.map(idx => this.messages[idx]);
      const summaryText = await this.requestSummary(messagesToSummarize);
      
      // Hide originals
      allIndicesToHide.forEach(idx => {
        this.messages[idx].hidden = true;
      });

      // Add summary message at the position of the first hidden non-system message
      const firstHiddenIdx = this.messages.findIndex(m => m.hidden && m.role !== 'system' && !m.summaryOf);
      const insertIdx = firstHiddenIdx !== -1 ? firstHiddenIdx : (this.messages[0]?.role === 'system' ? 1 : 0);

      this.messages.splice(insertIdx, 0, {
        id: this.generateId('sum'),
        role: 'system',
        content: `SUMMARY OF PREVIOUS CONTEXT:\n${summaryText}`,
        summaryOf: allIdsToSummarize
      });

      this.approximateTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
      console.log(`[AgentRuntime] Conversation summarized successfully (${turnsToSummarize.length} turns condensed).`);
    } catch (e) {
      // Robustness: failure just means we keep the original messages
      console.warn('[AgentRuntime] Summarization request failed:', e);
      throw e;
    }
  }

  private async requestSummary(messages: LLMMessage[]): Promise<string> {
    // Simple summary request using the same provider
    const summaryResponse = await this.options.provider.generate({
      messages: [
        { id: 'sum_req', role: 'system', content: 'Summarize the following design conversation concisely, preserving critical decisions and node IDs.' },
        ...messages
      ],
      maxTokens: 500
    });
    return summaryResponse.text || 'Context condensed.';
  }

  /**
   * Main agent loop
   * 
   * STRUCTURE:
   * 1. Setup Phase: Initialize messages, reset state
   * 2. Iteration Loop:
   *    - Mode Selection (PLANNING/EXECUTION/VERIFICATION)
   *    - System Prompt Reconstruction
   *    - LLM Generate
   *    - Tool Execution
   *    - Loop Detection
   *    - Context Management
   * 3. Termination: complete_task or max iterations
   */
  async run(userPrompt: string): Promise<string> {
    this.messages.push({ 
      id: this.generateId('usr'),
      role: 'user', 
      content: userPrompt 
    });
    this.approximateTokens += this.estimateTokens(userPrompt);

    // Reset plan for new request unless explicitly persisting
    if (!this.options.planId) {
      planState.reset();
    }

    // Proactive compression: trigger when usage exceeds threshold
    if (this.approximateTokens > this.maxContextTokens * AGENT_RUNTIME_CONSTANTS.CONTEXT_PROACTIVE_COMPRESSION_FACTOR) {
      await this.manageContext();
    }

    let iteration = 0;
    this.toolCallSignatureHistory = [];
    this.lastThinkingText = '';
    this.thinkingOnlyIterations = 0;
    this.progressCallCount = 0;
    this.staleStepIterations = 0;
    this.lastActiveStepId = null;
    this.idCounter = 0; // Better to reset idCounter at start of run if not already reset
    this.retryPolicy.resetAll();

    // ============================================
    // ITERATION LOOP
    // ============================================
    while (iteration < this.maxIterations) {
      this.collectionAttempts = 0; // Reset collection counter for each iteration to allow batching
      await this.manageContext();
      // 🟡 P2: compactThoughtSignatures disabled to protect prefix cache
      // this.compactThoughtSignatures(); 
      // Sync approximateTokens to actual visible context after manageContext
      this.approximateTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
      const currentTokens = this.approximateTokens;
      console.log(`[AgentRuntime] --- Iteration Start: ${iteration}/${this.maxIterations} ---`);
      console.log(`[AgentRuntime] Context Budget: ${currentTokens}/${this.maxContextTokens} tokens (${Math.round(currentTokens/this.maxContextTokens*100)}%)`);
      console.log(`[AgentRuntime] Visible messages: ${this.messages.filter(m => !m.hidden).length}, Hidden: ${this.messages.filter(m => m.hidden).length}`);

      // Hard stop: if context exceeds 120% of budget after compression, abort to prevent runaway costs
      if (currentTokens > this.maxContextTokens * 1.2) {
        console.error(`[AgentRuntime] FATAL: Context budget exceeded 120% (${currentTokens}/${this.maxContextTokens}) after compression. Aborting to prevent runaway token consumption.`);
        throw new Error(`Agent aborted: context budget exceeded 120% (${Math.round(currentTokens/this.maxContextTokens*100)}%). Context compression failed to reduce token count.`);
      }

      let progressCallsThisIteration = 0;

      // Timing for thinking timeout detection
      const iterationStartTime = Date.now();

      // LAZY LOADING: Don't call onIterationStart yet.
      // We will call it only when we have content to show.
      let hasNotifiedIterationStart = false;
      const notifyIterationStartOnce = () => {
        if (!hasNotifiedIterationStart) {
          const activeTask = planState.getActiveStep();
          const taskInfo = activeTask ? { taskId: activeTask.stepId, taskTitle: activeTask.title } : undefined;
          this.options.onIterationStart?.(iteration, taskInfo);
          hasNotifiedIterationStart = true;
        }
      };

      // ----------------------------------------
      // PHASE 1: MODE DETERMINATION
      // ----------------------------------------
      // 0. Determine Mode based on plan state
      let mode: AgentMode = 'PLANNING';
      let activeStep = planState.getActiveStep();
      const plan = planState.getPlan();

      // [FIX] Auto-activate the next pending step after planDesign.
      // Without an active step, the agent stays in PLANNING and cannot call execution tools.
      if (plan.length > 0 && !activeStep) {
        const nextPending = plan.find(s => s.status === 'pending');
        if (nextPending) {
          planState.startTask(nextPending.title, nextPending.description, nextPending.stepId);
          activeStep = planState.getActiveStep();
        }
      }
      
      if (plan.length > 0) {
        if (activeStep) {
          mode = 'EXECUTION';
        } else if (plan.every(s => s.status === 'completed')) {
          mode = 'VERIFICATION';
        } else {
          // Fallback: if there are pending steps but no active step, still allow execution tools.
          mode = 'EXECUTION';
        }
      }

      // ----------------------------------------
      // STALE STEP DETECTION
      // ----------------------------------------
      // [FIX] Track how long the same step has been active. If a step stays active
      // for too many iterations without completing, force-complete it and advance.
      // This prevents the infinite applyDesignPatch loop where the model keeps
      // "polishing" the same step without ever calling complete_task or summarize_progress.
      if (activeStep) {
        if (activeStep.stepId === this.lastActiveStepId) {
          this.staleStepIterations++;
        } else {
          this.staleStepIterations = 0;
          this.lastActiveStepId = activeStep.stepId;
        }

        if (this.staleStepIterations >= this.STALE_STEP_THRESHOLD) {
          console.warn(`[AgentRuntime] ⚠️ STALE STEP: "${activeStep.title}" (${activeStep.stepId}) has been active for ${this.staleStepIterations} iterations. Force-completing.`);
          planState.completeTask(activeStep.stepId, `Auto-completed after ${this.staleStepIterations} iterations`);
          this.staleStepIterations = 0;
          this.lastActiveStepId = null;

          // Check if there are more steps or if we're done
          const remainingSteps = planState.getPlan().filter(s => s.status === 'pending');
          if (remainingSteps.length === 0) {
            // All steps completed (or force-completed), transition to VERIFICATION
            console.log(`[AgentRuntime] All plan steps completed. Transitioning to VERIFICATION.`);
            mode = 'VERIFICATION';
            // Inject a message to trigger complete_task
            const completionMessage: LLMMessage = {
              id: this.generateId('stale_done'),
              role: 'user',
              content: 'All plan steps have been completed. Call complete_task now with a summary of what was built.'
            };
            this.messages.push(completionMessage);
          } else {
            // Activate next step
            const nextStep = remainingSteps[0];
            planState.startTask(nextStep.title, nextStep.description, nextStep.stepId);
            activeStep = planState.getActiveStep();
            console.log(`[AgentRuntime] Advanced to next step: "${nextStep.title}" (${nextStep.stepId})`);
          }
        }
      }

      // ----------------------------------------
      // PHASE 2: SYSTEM PROMPT CONSTRUCTION
      // ----------------------------------------
      // 1. Core System Prompt Reconstruction (Hot-Swapping)
      // [Self-Repair] Inject a USER-role recovery message when thinking loop detected.
      // User messages have much higher salience than system prompt modifications for Gemini.
      // The hidden rambling messages are already excluded from context (line 693+),
      // so this user message becomes the last visible message, maximizing its impact.
      if (this.thinkingOnlyIterations > 0) {
        const recoveryMessage: LLMMessage = {
          id: this.generateId('recovery'),
          role: 'user',
          content: `STOP TALKING. You have wasted ${this.thinkingOnlyIterations} turn(s) writing text instead of calling tools. Call a tool NOW. Current task: "${activeStep?.title || 'continue the design'}". Pick ONE: createNode, setNodeLayout, setNodeStyles, or complete_task.`
        };
        this.messages.push(recoveryMessage);
        console.log(`[AgentRuntime] 🔧 Injected user-role recovery message (thinkingOnly: ${this.thinkingOnlyIterations})`);
      }
      // 🟡 P2: Reuse or Generate System Prompt
      const deps = {
        ragResults: { prioritizedComponents: [], goldenTemplates: [] },
        intent: {},
        designSystemContext: { skillName: 'vanilla' },
        selectionContext: { hasSelection: false, nodes: [] }
      };
      const filteredTools = getToolsForMode(mode, this.options.tools); // Define filteredTools here for system prompt
      const systemPrompt = composeAgentSystemPrompt(
        deps,
        filteredTools,
        this.options.provider,
        {
          totalBudget: this.maxContextTokens,
          mode
        }
      );

      // Ensure system prompt is at index 0 and updated
      const existingSysIndex = this.messages.findIndex(m => m.role === 'system');
      if (existingSysIndex !== -1) {
        // Re-calculate if content actually changed to avoid unnecessary cache break (though it should be locked now)
        if (this.messages[existingSysIndex].content !== systemPrompt) {
          const sysMsg = this.messages.splice(existingSysIndex, 1)[0];
          sysMsg.content = systemPrompt;
          this.messages.unshift(sysMsg);
        }
      } else {
        this.messages.unshift({
          id: this.generateId('sys'),
          role: 'system',
          content: systemPrompt
        });
      }

      // ----------------------------------------
      // PHASE 3: PREPARE LLM CALL
      // ----------------------------------------
      // 2. Capture visible messages
      const visibleMessages = this.messages.filter(m => !m.hidden);
      
      // LOG VIZUALIZATION (Helpful for debugging loop recovery)
      if (this.thinkingOnlyIterations > 0) {
        console.log(`[AgentRuntime] 🔄 Loop Recovery Active. Context: ${visibleMessages.map(m => m.role).join(' -> ')}`);
      }
      
      // LOG FOR DEBUGGING IN TESTS
      if (process.env.NODE_ENV === 'test') {
        // console.log(`[DEBUG] Iteration ${iteration} Mode: ${mode} SysPrompt length: ${systemPrompt.length}`);
      }

      let response: LLMResponse;

      // ----------------------------------------
      // PHASE 4: LLM GENERATION
      // ----------------------------------------
      // Create AbortController for stream timeout
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        console.warn(`[AgentRuntime] Thinking timeout (${AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS}ms) - aborting stream`);
        abortController.abort();
      }, AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS);

      // ----------------------------------------
      // PLAN/ACT TOOL FILTERING
      // ----------------------------------------
      // Filter tools based on current mode to prevent mode mixing
      // filteredTools is already defined above for system prompt construction
      console.log(`[AgentRuntime] Mode: ${mode}, Tools available: ${filteredTools.length}/${this.options.tools.length}`);
      
      // [FIX] Rambling threshold varies by mode:
      // - PLANNING: 4x threshold (plans need more space for analysis)
      // - EXECUTION/VERIFICATION with ANY mode: NO stream abort (tool calls come AFTER text)
      // - Other modes: default threshold
      const isAnyToolMode = mode === 'EXECUTION' || mode === 'VERIFICATION';
      const ramblingThreshold = mode === 'PLANNING'
        ? AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD * 4  // 4x for planning
        : isAnyToolMode
          ? Infinity  // [FIX] NEVER abort stream in ANY mode - tool calls arrive LAST
          : AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD;

      // [FIX] Force Gemini to produce at least one tool call in EXECUTION and VERIFICATION modes.
      // This prevents the "cognitive loop" where Gemini generates pages of narration
      // ("I'm now building the header...") without ever actually calling tools.
      // PLANNING uses AUTO because planDesign is inherently a tool call.
      const toolConfig = (mode === 'EXECUTION' || mode === 'VERIFICATION')
        ? { mode: 'ANY' as const }
        : { mode: 'AUTO' as const };

      // [FIX] maxTokens tuned for batching without args bloat.
      // 2048 was too small (only 1 tool call). 8192 caused args explosion (40K+ chars per message).
      // 4096 is the sweet spot: enough for 2-3 tool calls with moderate args.
      // Combined with sanitizeToolCallsForHistory truncation, context stays controlled.
      const actionMaxTokens = (mode === 'EXECUTION' || mode === 'VERIFICATION') ? 8192 : undefined;

      let currentIterationText = '';
      const allowProgressStreaming = mode === 'PLANNING';
      let toolCallsForExecution: LLMToolCall[] = [];
      let rawToolCallsForLoopDetection: LLMToolCall[] = []; // Pre-batch calls for stable fingerprinting
      try {
        response = await this.options.provider.generate({
          messages: visibleMessages,
          tools: filteredTools,  // Use filtered tools based on mode
          toolConfig,
          maxTokens: actionMaxTokens,
          abortSignal: abortController.signal,
          streamTimeoutMs: AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS,
          onProgress: (chunk) => {
            notifyIterationStartOnce();

            // Active Rambling Detection during streaming.
            // EXECUTION mode uses toolConfig.mode='ANY' + reduced maxTokens.
            // ANY guarantees tool calls BUT Gemini streams text BEFORE tool calls.
            // Aborting in EXECUTION mode kills the stream before tool calls arrive.
            // So we only abort in PLANNING mode (not EXECUTION/VERIFICATION with ANY).
            currentIterationText += chunk;
            const accumulatedChars = currentIterationText.length;

            // [FIX] Only abort in modes where toolConfig is AUTO (not ANY).
            // In ANY mode, tool calls are guaranteed but arrive AFTER text in stream.
            if (accumulatedChars > ramblingThreshold) {
                // ramblingThreshold is Infinity for ANY modes, so this only triggers for AUTO modes
                console.warn(`[AgentRuntime] ⚠️ RAMBLING DETECTED: Stream aborted. Length: ${accumulatedChars} chars (Limit: ${ramblingThreshold}, Mode: ${mode})`);
                console.warn(`[AgentRuntime] This is often a sign of a "Thinking Loop" where the model ignores instructions and just updates status.`);

                // Extract progress header if present for de-duplication
                const progressMatch = currentIterationText.match(/Progress: \*\*([^*]+)\*\*/);
                if (progressMatch) {
                    const header = progressMatch[1].trim();
                    this.lastProgressHeaders.push(header);
                    if (this.lastProgressHeaders.length > 5) this.lastProgressHeaders.shift();
                }

                abortController.abort();
            }

            // [INFO] Log progress for ANY mode without aborting
            if (isAnyToolMode && accumulatedChars > AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD) {
                // Log once when threshold would have been hit in non-ANY mode
                if (accumulatedChars <= AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD + 100) {
                    console.log(`[AgentRuntime] 📝 ANY mode: ${accumulatedChars} chars text received, waiting for tool calls...`);
                }
            }

            const now = Date.now();
            if (allowProgressStreaming && now - this.lastNotificationTime >= this.THROTTLE_MS) {
              this.options.onProgress?.(chunk);
              this.lastNotificationTime = now;
            }
          },
          onThinking: (thought) => {
            if (thought && thought !== this.lastThinkingText) {
              notifyIterationStartOnce();
              const now = Date.now();
              if (now - this.lastNotificationTime >= this.THROTTLE_MS) {
                this.options.onThinking?.(thought);
                this.lastNotificationTime = now;
              }
              this.lastThinkingText = thought;
            }
          },
          thinkingLevel: DEFAULT_THINKING_LEVEL
        });

        let rawToolCalls = response.toolCalls || [];

        // Save raw (pre-batch) tool calls for loop detection — these have stable signatures
        // because they don't contain auto-generated opIds from buildBatchOperationsCall.
        rawToolCallsForLoopDetection = [...rawToolCalls];

        // 🔴 P1: Collection-Execution Mode — DISABLED
        // Previously made an extra LLM call when model returned only 1 batchable tool,
        // to "collect" more operations. In practice this doubled latency for minimal gain
        // (typically collecting 0-1 extra operations at the cost of 15-30s per call).
        // The model should be prompted to emit multiple tools in one response instead.
        if (mode === 'EXECUTION' && rawToolCalls.length === 1 &&
            this.AUTO_BATCH_TOOL_NAMES.has(rawToolCalls[0].name)) {
          console.log(`[AgentRuntime] Single batchable tool (${rawToolCalls[0].name}). Executing directly without collection.`);
        }

        const executionToolCalls = rawToolCalls.length > 1
          ? this.autoBatchToolCalls(rawToolCalls, mode)
          : rawToolCalls;

        if (executionToolCalls.length !== rawToolCalls.length) {
          const batchedOps = executionToolCalls.find(tc => tc.name === 'batchOperations')?.args?.operations?.length || 0;
          console.log(`[AgentRuntime] 🔗 Auto-batched ${rawToolCalls.length} tool calls into ${executionToolCalls.length} (batchOps: ${batchedOps})`);
        }

        toolCallsForExecution = executionToolCalls;
        // [FIX] Use executionToolCalls (post-batch) for history — this matches
        // what actually gets executed, preventing model/tool message mismatch.
        const historyToolCalls = this.sanitizeToolCallsForHistory(executionToolCalls);
        response.toolCalls = historyToolCalls;

        // Success: reset transient retry counters
        this.retryPolicy.reset('transient');
        this.retryPolicy.reset('malformed');
      } catch (error: any) {
        const category = this.retryPolicy.classifyError(error);
        const retryKey = category === AgentErrorCategory.RETRYABLE_TRANSIENT ? 'transient' :
                         category === AgentErrorCategory.RETRYABLE_MALFORMED ? 'malformed' : 'input';

        const delay = this.retryPolicy.getNextRetryDelay(category, retryKey);

        if (delay >= 0) {
          console.warn(`[AgentRuntime] ${category} error detected. Retrying after ${delay}ms...`);
          if (error.message) console.warn(`[AgentRuntime] Error message: ${error.message}`);

          // For MALFORMED_FUNCTION_CALL: inject a recovery hint so the model
          // sees different context on retry (otherwise it repeats the same error).
          if (category === AgentErrorCategory.RETRYABLE_MALFORMED) {
            const recoveryHint: LLMMessage = {
              id: this.generateId('mf_hint'),
              role: 'user',
              content: 'Your previous tool call had invalid syntax. Please emit a simpler, single tool call with valid JSON arguments. Use createNode, applyDesignPatch, or batchOperations.'
            };
            this.messages.push(recoveryHint);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
          iteration--; // Retry this iteration
          continue;
        }

        // No more retries or non-retryable error
        throw error;
      } finally {
        // Always clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
      }

      // If we got tools or text, ensure iteration start was notified
      if (response.text || (response.toolCalls && response.toolCalls.length > 0)) {
        notifyIterationStartOnce();
      }

      const activeTask = planState.getActiveStep();
      const taskInfo = activeTask ? { taskId: activeTask.stepId, taskTitle: activeTask.title } : undefined;
      this.options.onIteration?.(iteration, response, taskInfo);

      // Safety check for empty responses
      if (!response.text && (!response.toolCalls || response.toolCalls.length === 0) && !response.thoughts) {
        throw new Error('LLM Provider returned an empty response. This usually indicates a generation failure.');
      }

      // Thinking-only iteration detection: catch "rambling" without action
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const textLength = (response.text || '').length;

        // [FIX] Special case: ANY mode should ALWAYS return tool calls.
        // If it didn't, something went seriously wrong (API bug, stream corruption, etc.)
        // RETRY IMMEDIATELY instead of just counting - don't waste an iteration
        if (isAnyToolMode && textLength > AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD) {
          this.anyModeRetryCount = (this.anyModeRetryCount || 0) + 1;
          console.error(`[AgentRuntime] 🚨 CRITICAL: ANY mode returned NO tool calls! Retry ${this.anyModeRetryCount}/2`);
          console.error(`[AgentRuntime] Response text length: ${textLength}, toolConfig was: ${JSON.stringify(toolConfig)}`);

          if (this.anyModeRetryCount <= 2) {
            // Inject a stronger recovery message and retry this iteration
            const forceToolMessage: LLMMessage = {
              id: this.generateId('force'),
              role: 'user',
              content: `CRITICAL ERROR: You generated ${textLength} characters of text but ZERO tool calls. This violates the ANY mode constraint. You MUST call a tool NOW. Pick ONE: createNode, setNodeLayout, setNodeStyles, updateNodeProperties, or complete_task. Do NOT write any more text - just call the tool.`
            };
            this.messages.push(forceToolMessage);
            console.warn(`[AgentRuntime] 🔄 Retrying iteration ${iteration} with forced tool call message`);
            iteration--; // Retry this iteration
            continue;
          }
          // After 2 retries, fall through to normal handling
          console.error(`[AgentRuntime] ANY mode retry limit reached. Falling back to normal handling.`);
          this.thinkingOnlyIterations += 2; // Severe penalty
        }

        if (textLength > AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD) {
          // Long text without action = likely rambling
          this.thinkingOnlyIterations++;
          console.warn(`[AgentRuntime] ⚠️ THINKING-ONLY ITERATION (${this.thinkingOnlyIterations}/${AGENT_RUNTIME_CONSTANTS.MAX_THINKING_ONLY_ITERATIONS})`);
          console.warn(`[AgentRuntime] Result: Empty tool calls but response length is ${textLength} chars. (Threshold: ${AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD})`);

          if (this.thinkingOnlyIterations >= AGENT_RUNTIME_CONSTANTS.MAX_THINKING_ONLY_ITERATIONS) {
            console.error(`[AgentRuntime] Terminating due to maximum consecutive thinking-only iterations (${AGENT_RUNTIME_CONSTANTS.MAX_THINKING_ONLY_ITERATIONS}).`);
            throw new Error('Agent stuck: multiple iterations with long thinking but no actions. Breaking loop.');
          }
        }
        // Short text = probably final response, let it through
      } else {
        // Has tool calls = making progress, reset counters
        this.thinkingOnlyIterations = 0;
        this.anyModeRetryCount = 0;
      }

      // Add model's response to history
      const modelMessage = this.options.provider.formatResponse(response);
      modelMessage.id = this.generateId('mdl');

      // 🟡 P2: append-only recovery (removed logic that hid model messages)
// This text pollutes context (50K-70K tokens over 14 iterations) and reinforces the narration pattern.
      // By removing text parts, we keep only functional content (tool calls + thoughts) in context.
      if ((mode === 'EXECUTION' || mode === 'VERIFICATION') && response.toolCalls && response.toolCalls.length > 0) {
        if (Array.isArray(modelMessage.content)) {
          const originalLength = (modelMessage.content as Part[]).length;
          const originalParts = modelMessage.content as Part[];

          // Count text parts before filtering
          const textPartsBefore = originalParts.filter((p: Part) => p.text && !p.thought).length;

          modelMessage.content = originalParts.filter(
            (part: Part) => part.functionCall || part.thought
          );
          const stripped = originalLength - (modelMessage.content as Part[]).length;

          if (stripped > 0) {
            console.log(`[AgentRuntime] 🧹 Stripped ${stripped} narration text parts from ${mode} response. Kept ${(modelMessage.content as Part[]).length} functional parts.`);
          } else if (textPartsBefore > 0) {
            // Debug: text parts existed but weren't stripped - investigate
            console.warn(`[AgentRuntime] ⚠️ Text stripping expected but nothing removed. Original: ${originalLength}, textParts: ${textPartsBefore}`);
          }

          // Check for repetitive progress headers in the stripped text
          const textContent = response.text || '';
          const progressMatch = textContent.match(/Progress: \*\*([^*]+)\*\*/);
          if (progressMatch) {
            const header = progressMatch[1].trim();
            this.lastProgressHeaders.push(header);
            if (this.lastProgressHeaders.length > 5) this.lastProgressHeaders.shift();

            // Detect identical headers in recent history
            const sameHeaderCount = this.lastProgressHeaders.filter(h => h === header).length;
            if (sameHeaderCount >= 3) {
              console.warn(`[AgentRuntime] 🔄 Repeated Progress Header detected: "${header}" (${sameHeaderCount}x). Increasing loop suspicion.`);
              this.thinkingOnlyIterations++; // Treat as a loop signal even if it has tools
            }
          }
        } else {
          // Content is not an array (string) - this shouldn't happen for tool call responses
          console.warn(`[AgentRuntime] ⚠️ modelMessage.content is not an array in EXECUTION mode with tool calls. Type: ${typeof modelMessage.content}`);
        }
      }

      // [Self-Repair] Hide rambling messages to clear the loop anchor from context
      if (this.thinkingOnlyIterations > 0 && (!response.toolCalls || response.toolCalls.length === 0)) {
        console.log(`[AgentRuntime] Hiding rambling turn from future context to break loop anchor.`);
        modelMessage.hidden = true;
      }
      
      this.messages.push(modelMessage);
      const modelMessageTokens = this.estimateTokens(modelMessage.content);
      // Only count visible messages toward the budget
      if (!modelMessage.hidden) {
        this.approximateTokens += modelMessageTokens;
      }

      // [DEBUG] Track token growth per message
      const contentJson = typeof modelMessage.content === 'string'
        ? modelMessage.content
        : JSON.stringify(modelMessage.content);
      console.log(`[AgentRuntime] 📊 Model message added: ${modelMessageTokens} tokens (~${contentJson.length} chars). Total: ${this.approximateTokens} tokens`);

      // ----------------------------------------
      // PHASE 5: TOOL EXECUTION
      // ----------------------------------------
      if (toolCallsForExecution.length > 0) {
        // Handle Workflow Tools Internally
        const workflowResults: import('../llm-client/providers/types').LLMToolResult[] = [];
        const figmaToolCalls: LLMToolCall[] = [];

        for (const tc of toolCallsForExecution) {
          if (tc.name === 'planDesign') {
            const { analysis, steps } = tc.args || {};
            const stepsWithIds = (steps || []).map((step: any, idx: number) => ({
              ...step,
              stepId: step.stepId || `step_${Date.now()}_${idx}`,
              status: 'pending'
            }));

            planState.setCurrentPlan(stepsWithIds);

            console.log('[AgentRuntime] planDesign received:', {
              analysis: analysis?.substring(0, 300) + (analysis?.length > 300 ? '...' : ''),
              stepsCount: stepsWithIds.length
            });

            workflowResults.push({
              name: tc.name,
              response: {
                success: true,
                data: {
                  acknowledged: true,
                  planId: `plan_${Date.now()}`,
                  steps: stepsWithIds.map((s: any) => ({
                    stepId: s.stepId,
                    stepNumber: s.stepNumber,
                    action: s.action,
                    nodes: s.nodes || []
                  })),
                  message: 'Plan received. Each step is a COMPONENT CHUNK — use batchOperations to create ALL nodes listed in each step in ONE call. Do NOT use one tool call per step.'
                }
              },
              thought_signature: tc.thought_signature
            });
          } else if (tc.name === 'new_task') {
            planState.startTask(tc.args.title, tc.args.description, tc.args.stepId);
            workflowResults.push({ name: tc.name, response: { success: true }, thought_signature: tc.thought_signature });
          } else if (tc.name === 'update_todo_list') {
            planState.updateTodos(tc.args.items);
            workflowResults.push({ name: tc.name, response: { success: true }, thought_signature: tc.thought_signature });
          } else if (tc.name === 'summarize_progress') {
            if (progressCallsThisIteration >= 1) {
              workflowResults.push({
                name: tc.name,
                response: {
                  success: false,
                  error: {
                    code: 'PROGRESS_THROTTLED',
                    message: 'summarize_progress may be called at most once per iteration.'
                  }
                },
                thought_signature: tc.thought_signature
              });
              continue;
            }

            progressCallsThisIteration++;
            const summary = tc.args.summary;
            this.progressCallCount++;

            if (summary === this.lastProgressSummary) {
              this.identicalSummaryCount++;
            }

            // Two termination conditions: identical 3x, OR total calls exceed threshold+2
            if (this.identicalSummaryCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD ||
                this.progressCallCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD + 2) {
              const reason = this.identicalSummaryCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD
                ? `Repeating same progress summary: "${summary}"`
                : `summarize_progress called ${this.progressCallCount} times without completing task`;
              const semanticError = mapToSemanticError('LOOP_DETECTED', reason);
              workflowResults.push({
                name: tc.name,
                response: { success: false, error: { code: 'LOOP_DETECTED', message: formatSemanticError(semanticError) } },
                thought_signature: tc.thought_signature
              });
              continue;
            }

            if (summary !== this.lastProgressSummary) {
              this.identicalSummaryCount = 0;
            }
            this.lastProgressSummary = summary;

            if (tc.args.isComplete) {
              planState.completeTask(undefined, tc.args.summary);
            }
            workflowResults.push({ name: tc.name, response: { success: true }, thought_signature: tc.thought_signature });
          } else if (tc.name === 'complete_task') {
            if (this.hasPendingToolErrors) {
              workflowResults.push({
                name: tc.name,
                response: {
                  success: false,
                  error: {
                    code: 'PENDING_TOOL_ERRORS',
                    message: 'Cannot complete task while previous tool calls have errors. Fix the errors first.'
                  }
                },
                thought_signature: tc.thought_signature
              });
            } else {
              // Agent signals completion - return summary and exit
              return tc.args.summary + (tc.args.verification ? `\n\nVerification: ${tc.args.verification}` : '');
            }
          } else {
            figmaToolCalls.push(tc);
          }
        }

        // If we ONLY had workflow tools, and no actual work, we might not want to continue this iteration in UI?
        // But LLM usually calls them along with other tools or precedes them.

        // If we ONLY had workflow tools, and no actual work, we still need to record the results
        const toolResults: import('../llm-client/providers/types').LLMToolResult[] = [...workflowResults];

        // ----------------------------------------
        // PHASE 6: LOOP DETECTION (moved BEFORE figmaToolCalls check)
        // ----------------------------------------
        // [FIX] Use RAW (pre-batch) tool calls for loop detection fingerprinting.
        // Auto-batched calls generate unique opIds (timestamp-based) each iteration,
        // which defeats loop detection by producing different hashes every time.
        // Raw tool calls have stable args from the LLM, enabling proper duplicate detection.
        const allToolCalls = toolCallsForExecution || [];
        const loopDetectionCalls = rawToolCallsForLoopDetection.length > 0
          ? rawToolCallsForLoopDetection
          : allToolCalls;

        // A signature looks at tool name + target context + content fingerprint
        const semanticSignature = loopDetectionCalls.map(tc => {
          const targetNodeId = tc.args?.nodeId;
          const parentId = tc.args?.parentId || tc.args?.parentRef;

          // [Phase 2.5] Declarative Fingerprinting Logic
          // We use longer sampling (64 chars) and context (parentId) to distinguish similar nodes
          let fingerprint = '';
          const nameSample = tc.args?.name ? `|name:${this.sanitizeString(tc.args.name, 64)}` : '';
          const contextSample = parentId ? `|parent:${this.sanitizeString(parentId, 32)}` : '';

          if (tc.name === 'updateNodeProperties' && tc.args?.properties) {
             const propsHash = this.hashString(JSON.stringify(tc.args.properties));
             fingerprint = `|props:${propsHash}`;
          } else if (tc.name === 'setNodeStyles' && (tc.args?.fills || tc.args?.strokes)) {
             const stylesHash = this.hashString(JSON.stringify({ f: tc.args.fills, s: tc.args.strokes }));
             fingerprint = `|style:${stylesHash}`;
          } else if (tc.name === 'createNode') {
            fingerprint = `${nameSample}${contextSample}`;
          } else if (tc.name === 'createIcon' && tc.args?.iconName) {
            fingerprint = `|icon:${tc.args.iconName}${contextSample}`;
          } else if (tc.name === 'applyDesignPatch' && tc.args?.patches?.length > 0) {
            // Group hash of patches to distinguish different patch sets
            const patchHash = this.hashString(JSON.stringify(tc.args.patches.map((p: any) => ({ n: p.nodeId || p.nodeRef, l: !!p.layout, s: !!p.styles }))));
            fingerprint = `|patch:${tc.args.patches.length}|hash:${patchHash}`;
          } else if (tc.name === 'batchOperations' && Array.isArray(tc.args?.operations)) {
            const opIds = tc.args.operations
              .map((op: any) => op?.opId || op?.action)
              .filter(Boolean)
              .join(',');
            fingerprint = `|batch:${tc.args.operations.length}|ops:${this.hashString(opIds)}`;
          } else if (tc.name === 'summarize_progress' && tc.args?.summary) {
            fingerprint = `|sum:${this.hashString(tc.args.summary)}`;
          } else if (tc.name === 'update_todo_list' && tc.args?.items) {
            fingerprint = `|todo:${this.hashString(JSON.stringify(tc.args.items))}`;
          } else if (tc.name === 'new_task' && (tc.args?.title || tc.args?.description)) {
            fingerprint = `|task:${this.hashString(tc.args.title + '|' + tc.args.description)}`;
          } else if (tc.name === 'planDesign' && tc.args?.analysis) {
            fingerprint = `|plan:${this.hashString(tc.args.analysis)}`;
          } else if (tc.name === 'inspectDesign') {
            // [FIX] Include mode and depth to distinguish different inspection calls
            // This prevents false positive loop detection when Agent inspects with different parameters
            const mode = tc.args?.mode || 'selection';
            const depth = tc.args?.depth ?? 5;
            fingerprint = `|mode:${mode}|depth:${depth}`;
          }

          const identifier = targetNodeId || 'new';
          return `${tc.name}[${identifier}${fingerprint}]`;
        }).join('|');

        this.toolCallSignatureHistory.push(semanticSignature);
        if (this.toolCallSignatureHistory.length > 10) this.toolCallSignatureHistory.shift();

        // Semantic Planning Loop Detection: Check for repeated planDesign calls without progress
        // [FIX] Check ALL tool calls, not figmaToolCalls (planDesign is a workflow tool)
        const planCallCount = allToolCalls.filter(tc => tc.name === 'planDesign').length;
        if (planCallCount > 0) {
          const recentPlanCalls = this.toolCallSignatureHistory.filter(sig => sig.includes('planDesign'));
          if (recentPlanCalls.length >= 3) {
            throw new Error(`Agent stuck in planning loop: planDesign called 3+ times consecutively. Try giving more specific instructions.`);
          }
        }

        // Semantic Loop Detection: Check for repeating patterns using signatures
        // [FIX] Moved BEFORE early exit to catch workflow-only loops too
        const identicalSignatureCount = this.toolCallSignatureHistory.filter(sig => sig === semanticSignature).length;
        if (identicalSignatureCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD) {
          throw new Error(
            `[LOOP DETECTED] Same action repeated ${identicalSignatureCount} times: ${semanticSignature}. ` +
            `Consider: (1) Check if previous tool succeeded (2) Try different approach (3) Call complete_task if done.`
          );
        }

        // [FIX] Secondary loop detector: catch "same tool type" repetition even with different args.
        // The model may call applyDesignPatch with slightly different nodeIds/patches each time,
        // producing different signatures but still being stuck in a polish loop.
        // If the last N signatures all contain only the same tool name(s), it's likely a loop.
        const MONOTONE_LOOP_THRESHOLD = 8; // More lenient than exact match since args differ
        if (this.toolCallSignatureHistory.length >= MONOTONE_LOOP_THRESHOLD) {
          const recentSignatures = this.toolCallSignatureHistory.slice(-MONOTONE_LOOP_THRESHOLD);
          // Extract the set of tool names from each signature
          const toolNamePatterns = recentSignatures.map(sig => {
            const toolNames = sig.split('|')
              .map(s => s.split('[')[0])
              .filter(Boolean)
              .sort()
              .join('+');
            return toolNames;
          });
          // If all recent iterations use the same tool name pattern
          const allSamePattern = toolNamePatterns.every(p => p === toolNamePatterns[0]);
          if (allSamePattern && toolNamePatterns[0]) {
            // Only trigger for modify-only patterns (not read tools like inspectDesign)
            const isModifyOnly = !toolNamePatterns[0].includes('inspectDesign') &&
                                 !toolNamePatterns[0].includes('planDesign') &&
                                 !toolNamePatterns[0].includes('complete_task');
            if (isModifyOnly) {
              console.warn(`[AgentRuntime] 🔄 MONOTONE LOOP: Same tool pattern "${toolNamePatterns[0]}" for ${MONOTONE_LOOP_THRESHOLD} consecutive iterations. Injecting completion hint.`);
              // Instead of throwing, inject a strong completion hint
              const completionHint: LLMMessage = {
                id: this.generateId('mono_loop'),
                role: 'user',
                content: `⚠️ LOOP DETECTED: You have called "${toolNamePatterns[0]}" for ${MONOTONE_LOOP_THRESHOLD} consecutive iterations. The design is good enough. Call complete_task NOW with a summary. Do NOT make any more style changes.`
              };
              this.messages.push(completionHint);
              this.approximateTokens += this.estimateTokens(completionHint.content);
            }
          }
        }

        // Early exit if only workflow tools (no figma tools to execute)
        if (figmaToolCalls.length === 0) {
           const workflowResultsMessage = this.options.provider.formatToolResults(workflowResults);
           workflowResultsMessage.id = this.generateId('tol');
           this.messages.push(workflowResultsMessage);
           const workflowTokens = this.estimateTokens(workflowResultsMessage.content);
           this.approximateTokens += workflowTokens;
           // [DEBUG] Track workflow-only results
           console.log(`[AgentRuntime] 📊 Workflow results added: ${workflowTokens} tokens. Total: ${this.approximateTokens} tokens`);
           iteration++;
          continue;
        }

        // Group tool calls by strategy for figmaToolCalls
        const groups: { strategy: 'parallel' | 'sequential', calls: LLMToolCall[] }[] = [];
        for (const tc of figmaToolCalls) {
          const toolDef = this.options.tools.find(t => t.name === tc.name);
          const strategy = toolDef?.executionStrategy || 'sequential'; // Default to sequential for safety
          
          if (groups.length > 0 && groups[groups.length - 1].strategy === strategy) {
            groups[groups.length - 1].calls.push(tc);
          } else {
            groups.push({ strategy, calls: [tc] });
          }
        }

        // Track failed nodeIds to skip only dependent operations
        const failedNodeIds = new Set<string>();
        const failureReasons = new Map<string, string>();

        for (const group of groups) {
          if (group.strategy === 'parallel') {
            console.log(`[AgentRuntime] Executing parallel group of ${group.calls.length} tools`);
            const results = await Promise.all(group.calls.map(async (tc) => {
              this.options.onToolCall?.(tc);
              const result = await this.executeToolWithTimeout(tc);
              this.options.onToolResult?.(tc, result);
              return {
                name: tc.name,
                response: this.cleanToolResult(result),
                thought_signature: tc.thought_signature
              };
            }));
            toolResults.push(...results);
          } else {
            console.log(`[AgentRuntime] Executing sequential group of ${group.calls.length} tools`);
            for (const tc of group.calls) {
              this.options.onToolCall?.(tc);
              
              // NEW: Extract nodeId and parentId from tool args for dependency tracking
              const targetNodeId = tc.args?.nodeId || tc.args?.parentId;
              
              let result: any;
              
              // NEW: Only skip if this tool operates on a previously failed nodeId
              if (targetNodeId && failedNodeIds.has(targetNodeId)) {
                const reason = failureReasons.get(targetNodeId) || 'Previous operation failed';
                result = { 
                  success: false, 
                  error: { 
                    code: 'DEPENDENCY_SKIP', 
                    message: `Skipped: node ${targetNodeId} had a previous error: ${reason}` 
                  } 
                };
                console.log(`[AgentRuntime] Skipping ${tc.name} due to dependency on failed node ${targetNodeId}`);
              } else {
                result = await this.executeToolWithTimeout(tc);
                
                // NEW: Track failed nodeIds for smarter skipping
                if (result?.success === false && targetNodeId) {
                  failedNodeIds.add(targetNodeId);
                  failureReasons.set(targetNodeId, result.error?.message || 'Unknown error');
                }
              }

              this.options.onToolResult?.(tc, result);
              const toolResult = this.cleanToolResult(result); // Clean result here

              // NEW: Add semantic feedback to tool results
              if (!toolResult.success && toolResult.error) {
                const semanticError = mapToSemanticError(toolResult.error.code, toolResult.error.message);
                toolResult.error.semanticFeedback = formatSemanticError(semanticError);
              }

              toolResults.push({
                name: tc.name,
                response: toolResult,
                thought_signature: tc.thought_signature
              });
            }
          }
        }

        if (figmaToolCalls.length > 0) {
          const figmaToolNames = new Set(figmaToolCalls.map(tc => tc.name));
          const hadErrors = toolResults.some(tr => tr.response?.success === false && figmaToolNames.has(tr.name));
          this.hasPendingToolErrors = hadErrors;
        }

        // Add tool results to history using provider-specific formatting
        const toolResultsMessage = this.options.provider.formatToolResults(toolResults);
        toolResultsMessage.id = this.generateId('tol');
        this.messages.push(toolResultsMessage);
        const toolResultsTokens = this.estimateTokens(toolResultsMessage.content);
        this.approximateTokens += toolResultsTokens;

        // [DEBUG] Track token growth from tool results
        const toolResultsJson = JSON.stringify(toolResultsMessage.content);
        console.log(`[AgentRuntime] 📊 Tool results added: ${toolResultsTokens} tokens (~${toolResultsJson.length} chars). Total: ${this.approximateTokens} tokens`);

        // [FIX] Single-tool-call feedback: when model emits only 1 tool in EXECUTION mode,
        // inject a hint to batch more operations next iteration. This is much cheaper than
        // the old "collection" approach (which made a full extra LLM call).
        if (mode === 'EXECUTION' && allToolCalls.length === 1 &&
            allToolCalls[0].name !== 'complete_task' && allToolCalls[0].name !== 'summarize_progress') {
          const batchHint: LLMMessage = {
            id: this.generateId('batch_hint'),
            role: 'user',
            content: `⚠️ You used only 1 tool call this turn. BATCH RULE: use batchOperations to combine 3-5+ operations per call. Create ALL remaining nodes for the current step in ONE batchOperations call.`
          };
          this.messages.push(batchHint);
          this.approximateTokens += this.estimateTokens(batchHint.content);
          console.log(`[AgentRuntime] ⚠️ Single-tool hint injected (was: ${allToolCalls[0].name})`);
        }

        // Proactive compression after tool results added
        if (this.approximateTokens > this.maxContextTokens * AGENT_RUNTIME_CONSTANTS.CONTEXT_PROACTIVE_COMPRESSION_FACTOR) {
          await this.manageContext();
        }

        // Continue the loop
        iteration++;
        continue;
      } else {
        // No tool calls - pure text response (final summary or completion)
        // Short text: accept as final response
        // Long text: warn but still accept (don't crash)
        if (this.hasPendingToolErrors) {
          const recoveryMessage: LLMMessage = {
            id: this.generateId('usr'),
            role: 'user',
            content: 'There are unresolved tool errors from the last actions. Fix the errors using tools before completing the task.'
          };
          this.messages.push(recoveryMessage);
          console.warn('[AgentRuntime] Blocking text-only completion due to pending tool errors. Retrying with recovery message.');
          iteration--;
          continue;
        }
        if (response.text && response.text.length > 500) {
          console.warn('[AgentRuntime] Long response without tool calls. Consider using complete_task.');
        }
        return response.text;
      }
    }

    throw new Error(`Agent reached maximum iterations (${this.maxIterations})`);
  }

  private async executeToolWithTimeout(tc: LLMToolCall): Promise<any> {
    const timeout = AGENT_RUNTIME_CONSTANTS.DEFAULT_TOOL_TIMEOUT_MS;
    
    return Promise.race([
      this.executeTool(tc),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Tool execution timed out after ${timeout}ms: ${tc.name}`)), timeout);
      })
    ]).catch(e => {
      console.error(`[AgentRuntime] Tool execution failed: ${tc.name}`, e);
      return { 
        success: false, 
        error: { 
          code: categoryToErrorCode(this.retryPolicy.classifyError(e)), 
          message: e.message 
        } 
      };
    });
  }

  private async executeTool(tc: LLMToolCall): Promise<any> {
    const toolExec = this.options.toolExecutors?.[tc.name];
    
    try {
      if (toolExec) {
        return await toolExec(tc.args);
      } else if (this.options.ipcBridge) {
        return await this.options.ipcBridge.callTool(tc.name, tc.args);
      } else {
        return { success: false, error: { code: 'NO_TOOL_EXECUTOR', message: `No executor found for tool '${tc.name}'` } };
      }
    } catch (e: any) {
      return { 
        success: false, 
        error: { 
          code: 'TOOL_EXEC_EXCEPTION', 
          message: e.message 
        } 
      };
    }
  }

  /**
   * Clean and truncate tool results to prevent context explosion.
   * Tool results with large data payloads can consume excessive tokens.
   */
  private cleanToolResult(result: any): any {
    if (!result || typeof result !== 'object') {
      return result;
    }

    const cleaned = { ...result };

    // Clean error object
    if (cleaned.error && typeof cleaned.error === 'object') {
      cleaned.error = {
        message: cleaned.error.message || 'Unknown error',
        code: cleaned.error.code,
        ...(cleaned.error.semanticFeedback && { semanticFeedback: cleaned.error.semanticFeedback })
      };
    }

    // [FIX] Truncate large data payloads to prevent context explosion
    // Tool results like createNode can return full node properties (colors, styles, children, etc.)
    // which accumulate to 50K-100K tokens over 20 iterations
    const MAX_DATA_CHARS = 2000; // ~500 tokens max per tool result

    if (cleaned.data) {
      const dataJson = JSON.stringify(cleaned.data);
      console.log(`[AgentRuntime] cleanToolResult: data size = ${dataJson.length} chars (limit: ${MAX_DATA_CHARS})`);

      if (dataJson.length > MAX_DATA_CHARS) {
        // [MOD] Special handling for batchOperations results to preserve idMap
        if (cleaned.data.idMap && cleaned.data.results) {
          const BATCH_BUDGET = 4000; // Larger budget for batch results
          const essentialData: any = {
            idMap: cleaned.data.idMap, // Always keep full idMap
            results: cleaned.data.results.map((r: any) => ({
              opId: r.opId,
              action: r.action,
              success: r.success,
              ...(r.nodeId && { nodeId: r.nodeId }),
              ...(r.name && { name: r.name }),
              ...(r.error && { 
                error: { 
                  code: r.error.code, 
                  message: r.error.message,
                  ...(r.error.semanticFeedback && { semanticFeedback: r.error.semanticFeedback })
                } 
              }),
              ...(Array.isArray(r.children) && {
                children: r.children.map((c: any) => ({
                  opId: c.opId,
                  success: c.success,
                  ...(c.nodeId && { nodeId: c.nodeId }),
                  ...(c.name && { name: c.name }),
                }))
              }),
            })),
            _truncated: true,
            _originalSize: dataJson.length,
          };

          // layoutSnapshots: keep within remaining budget (prioritize root/parents)
          if (cleaned.data.layoutSnapshots && typeof cleaned.data.layoutSnapshots === 'object') {
            essentialData.layoutSnapshots = Object.fromEntries(
              Object.entries(cleaned.data.layoutSnapshots)
                .slice(0, 10) // Limit to first 10 snapshots to save space
                .map(([opId, snap]: [string, any]) => [
                  opId,
                  {
                    id: snap?.id || snap?.nodeId,
                    width: snap?.width,
                    height: snap?.height,
                    // Minimal context: only dimensions are critical for layout reasoning
                  }
                ])
            );
          }

          cleaned.data = essentialData;
          console.log(`[AgentRuntime] 📦 Cleaned batch tool result data: ${dataJson.length} -> ${JSON.stringify(essentialData).length} chars`);
          return cleaned;
        }

        // For successful results, keep only essential fields
        if (cleaned.success && typeof cleaned.data === 'object') {
          const essentialData: any = {};

          // Keep nodeId - essential for chaining operations
          if (cleaned.data.nodeId) essentialData.nodeId = cleaned.data.nodeId;
          if (cleaned.data.id) essentialData.id = cleaned.data.id;

          // Keep node name and type for context
          if (cleaned.data.name) essentialData.name = cleaned.data.name;
          if (cleaned.data.type) essentialData.type = cleaned.data.type;

          // Keep parent reference
          if (cleaned.data.parentId) essentialData.parentId = cleaned.data.parentId;

          // [FIX] Keep children skeleton for inspectDesign hierarchy results
          // This allows Agent to see child structure (id, name, type) without full properties
          if (Array.isArray(cleaned.data.children)) {
            essentialData.childrenCount = cleaned.data.children.length;

            const MAX_CHILDREN_SKELETON = 20;
            const extractSkeleton = (node: any, depth: number): any => {
              if (!node || depth > 2) return null;
              const skeleton: any = {
                id: node.id,
                name: node.props?.name || node.name,
                type: node.type
              };
              if (Array.isArray(node.children) && node.children.length > 0 && depth < 2) {
                skeleton.children = node.children
                  .slice(0, MAX_CHILDREN_SKELETON)
                  .map((c: any) => extractSkeleton(c, depth + 1))
                  .filter(Boolean);
                if (node.children.length > MAX_CHILDREN_SKELETON) {
                  skeleton._more = node.children.length - MAX_CHILDREN_SKELETON;
                }
              }
              return skeleton;
            };

            essentialData.children = cleaned.data.children
              .slice(0, MAX_CHILDREN_SKELETON)
              .map((c: any) => extractSkeleton(c, 1))
              .filter(Boolean);

            if (cleaned.data.children.length > MAX_CHILDREN_SKELETON) {
              essentialData._moreChildren = cleaned.data.children.length - MAX_CHILDREN_SKELETON;
            }
          }

          // [FIX] Preserve idMap and layoutSnapshots for batchOperations feedback
          if (cleaned.data.idMap && typeof cleaned.data.idMap === 'object') {
            essentialData.idMap = cleaned.data.idMap;
          }
          if (cleaned.data.layoutSnapshots && typeof cleaned.data.layoutSnapshots === 'object') {
            // Keep basic layout info from each snapshot
            essentialData.layoutSnapshots = Object.fromEntries(
              Object.entries(cleaned.data.layoutSnapshots).map(([opId, snap]: [string, any]) => [
                opId,
                {
                  id: snap?.id || snap?.nodeId,
                  name: snap?.name,
                  type: snap?.type,
                  x: snap?.x,
                  y: snap?.y,
                  width: snap?.width,
                  height: snap?.height,
                }
              ])
            );
          }

          // Add truncation notice
          essentialData._truncated = true;
          essentialData._originalSize = dataJson.length;

          cleaned.data = essentialData;
          console.log(`[AgentRuntime] 📦 Truncated tool result data: ${dataJson.length} -> ${JSON.stringify(essentialData).length} chars`);
        } else {
          // For non-object data or failures, just stringify and truncate
          cleaned.data = {
            _truncated: true,
            _originalSize: dataJson.length,
            summary: dataJson.substring(0, 500) + '...'
          };
          console.log(`[AgentRuntime] 📦 Truncated non-object tool result: ${dataJson.length} chars`);
        }
      }
    }

    return cleaned;
  }

  public getMessages(): LLMMessage[] {
    return this.messages;
  }
}

/**
 * Convertex agent error category to a tool error code.
 */
function categoryToErrorCode(category: AgentErrorCategory): string {
  switch (category) {
    case AgentErrorCategory.RETRYABLE_TRANSIENT: return 'TOOL_TRANSIENT_ERROR';
    case AgentErrorCategory.RETRYABLE_MALFORMED: return 'TOOL_FORMAT_ERROR';
    case AgentErrorCategory.NON_RETRYABLE_INPUT: return 'TOOL_INVALID_INPUT';
    case AgentErrorCategory.LOCAL_TOOL_ERROR: return 'TOOL_EXECUTION_ERROR';
    default: return 'TOOL_UNKNOWN_ERROR';
  }
}
