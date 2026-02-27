/**
 * @file agentRuntime.ts
 * @description Core runtime for the agentic loop. Orchestrates LLM calls and tool execution.
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMToolCall, Part } from '../llm-client/providers/types';
import { ToolDefinition, ToolParameter, getToolsForMode, AgentMode, ToolValidator } from './tools';
import { IpcBridge } from './ipcBridge';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { RetryPolicy, AgentErrorCategory } from './retryPolicy';
import { planState } from './planState';
import { mapToSemanticError, formatSemanticError } from '../utils/errorUtils';
import { AgentBehaviorConfig, DEFAULT_BEHAVIOR, resolveBehavior } from './agentBehaviorConfig';
import { estimateTokens } from './context/tokenEstimator';
import { CONTEXT_CONSTANTS } from './context/constants';
import { ToolResultCleaner } from './context/toolResultCleaner';
import { ContextManager } from './context/contextManager';
import { PromptAssembler } from './context/promptAssembler';
import { AgentStateMachine } from './agentStateMachine';
import {
  AgentLoopPolicy,
  resolveAgentLoopPolicy,
  getToolModeForPhase,
  getMaxTokensForPhase,
} from './agentLoopPolicy';
import { LoopDetector } from './loopDetector';

export interface AgentRuntimeOptions {
  provider: LLMProvider;
  tools: ToolDefinition[];
  ipcBridge?: IpcBridge; // Optional to allow for extensive mocking or local-only modes
  maxIterations?: number;
  maxContextTokens?: number; // Max tokens before context compression
  systemPrompt?: string;
  planId?: string; // Optional ID for persistent planning
  behaviorConfig?: Partial<AgentBehaviorConfig>; // Agent behavior knobs (see agentBehaviorConfig.ts)
  selectionContext?: { hasSelection: boolean; nodes: any[] }; // Current Figma selection
  onIteration?: (iteration: number, response: LLMResponse, taskInfo?: { taskId: string, taskTitle: string }) => void;
  onToolCall?: (toolCall: LLMToolCall) => void;
  onToolResult?: (toolCall: LLMToolCall, result: any) => void;
  onProgress?: (step: string) => void;
  onThinking?: (thought: string) => void;
  onIterationStart?: (iteration: number, taskInfo?: { taskId: string, taskTitle: string }) => void;
  toolExecutors?: Record<string, import('./tools/types').ToolExecutor>;
  designSystemId?: string; // Added for skill-based prompting
  messages?: LLMMessage[]; // Initial messages for the context manager
  loopPolicy?: Partial<AgentLoopPolicy>; // Unified runtime control policy
}

export class AgentRuntime {
  private maxIterations: number;
  private maxContextTokens: number;
  private context: ContextManager;
  private stateMachine: AgentStateMachine;
  private promptAssembler: PromptAssembler;
  private retryPolicy: RetryPolicy;
  private cleaner: ToolResultCleaner;
  private idCounter: number = 0;
  private lastThinkingText: string = '';
  private loopDetector = new LoopDetector();
  private thinkingOnlyIterations: number = 0;
  private anyModeRetryCount: number = 0;
  private textOnlyCompletionRetries: number = 0;
  private lastNotificationTime: number = 0;
  private readonly THROTTLE_MS = 100;
  private lastProgressSummary: string = '';
  private identicalSummaryCount: number = 0;
  private progressCallCount: number = 0;
  private lastProgressHeaders: string[] = [];
  private hasPendingToolErrors: boolean = false;
  private emptyResponseRetries: number = 0;
  private completeTaskRejectionCount = 0; // Safety valve for agent deadlocks over over-achieving
  private noVerificationRejectionCount = 0; // Independent safety valve for NO_VERIFICATION gate
  private readonly AUTO_BATCH_TOOL_NAMES = new Set([
    'createIcon',
    'deleteNode',
    'applyDesignPatch',
    'patchNode'
  ]);
  systemPrompt?: string;
  behaviorConfig: AgentBehaviorConfig;
  loopPolicy: AgentLoopPolicy;
  private originalUserRequest: string = '';
  private currentMode: AgentMode = 'PLANNING'; 
  private designSystemId?: string;
  private operationLog: Array<{
    opId?: string;
    action: string;
    reason?: string;
    success: boolean;
    timestamp: number;
    error?: string;
    diffInfo?: string[];
  }> = [];

  constructor(private options: AgentRuntimeOptions) {
    this.retryPolicy = new RetryPolicy();
    this.behaviorConfig = resolveBehavior(options.behaviorConfig);
    this.loopPolicy = resolveAgentLoopPolicy(options.loopPolicy);
    this.maxIterations = options.maxIterations || this.behaviorConfig.maxIterations;
    // FIX: Limit context to prevent MALFORMED_FUNCTION_CALL from excessive prompt size
    this.maxContextTokens = options.maxContextTokens || AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_CONTEXT_TOKENS;
    this.designSystemId = options.designSystemId; // Initialize designSystemId
    this.cleaner = new ToolResultCleaner(options.tools);
    this.context = new ContextManager(this.maxContextTokens, options.messages);
    this.stateMachine = new AgentStateMachine(this.loopPolicy, (prefix) => this.generateId(prefix));
    this.promptAssembler = new PromptAssembler({
      provider: options.provider,
      tools: options.tools,
      maxContextTokens: this.maxContextTokens,
      behaviorConfig: this.behaviorConfig,
      designSystemId: this.designSystemId,
      selectionContext: options.selectionContext,
      generateId: (prefix) => this.generateId(prefix)
    });

    // Disable throttling in tests
    if (process.env.NODE_ENV === 'test') {
      (this as any).THROTTLE_MS = 0;
    }
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
   * Phase-aware thinking policy:
   * - Keep configured level in PLANNING/VERIFICATION/RECOVERY
   * - Force EXECUTION to low for faster, more deterministic tool emission
   */
  private getThinkingLevelForMode(mode: AgentMode): AgentBehaviorConfig['thinkingLevel'] {
    if (mode === 'EXECUTION') {
      if (this.behaviorConfig.thinkingLevel === 'minimal') return 'minimal';
      return 'low';
    }
    return this.behaviorConfig.thinkingLevel;
  }


  private sanitizeToolCallsForHistory(toolCalls: LLMToolCall[]): LLMToolCall[] {
    return this.cleaner.sanitizeToolCallsForHistory(toolCalls);
  }

  private compactThoughtSignatures(): void {
    let lastToolIdx = -1;
    for (let i = this.context.getAllMessages().length - 1; i >= 0; i--) {
      const msg = this.context.getAllMessages()[i];
      if (msg.hidden || msg.role !== 'tool') continue;
      if (Array.isArray(msg.content) && msg.content.some((p: any) => p.functionResponse)) {
        lastToolIdx = i;
        break;
      }
    }

    const preserve = new Set<number>();
    if (lastToolIdx !== -1) preserve.add(lastToolIdx);

    let mutated = false;
    for (let i = 0; i < this.context.getAllMessages().length; i++) {
      if (preserve.has(i)) continue;
      const msg = this.context.getAllMessages()[i];
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
      this.context.updateTokens();
      console.log(`[AgentRuntime] 🧽 Compacted thought signatures in tool history. Visible tokens: ${this.context.getApproximateTokens()}`);
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
   * Delegates context management to ContextManager.
   */
  private async manageContext(): Promise<void> {
    const summarizer = async (messages: LLMMessage[]): Promise<string> => {
      // Strip massive payloads before summarizing to save budget on the summarizer itself
      const strippedMessages = messages.map(m => {
          let contentStr = '';
          if (typeof m.content === 'string') {
              contentStr = m.content.substring(0, 500) + (m.content.length > 500 ? '...' : '');
          } else if (Array.isArray(m.content)) {
              contentStr = m.content.map(part => {
                  if (part.functionCall) return `[Call: ${part.functionCall.name}]`;
                  if (part.functionResponse) return `[Result: ${part.functionResponse.name}]`;
                  return '[Part]';
              }).join(' ');
          }
          return `${m.role.toUpperCase()}: ${contentStr}`;
      });

      const summaryPrompt = `Please summarize the following Figma plugin design steps briefly in 1-2 sentences. Focus on what was built or changed. Example: "Created the layout structure and added a submit button."\n\nHistory:\n${strippedMessages.join('\n')}`;
      
      try {
        const response = await this.options.provider.generate({
          messages: [{ id: `sum_req_${Date.now()}`, role: 'user', content: summaryPrompt }],
          maxTokens: 150,
          thinkingLevel: 'minimal'
        });
        return response.text || "Conversation summarized.";
      } catch (error) {
        console.warn("[AgentRuntime] Summarizer failed, using fallback summary.", error);
        return "Several design steps completed.";
      }
    };

    await this.context.manageContext(summarizer);
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
    // Store original request for instruction anchoring
    this.originalUserRequest = userPrompt;

    this.context.addMessage({
      id: this.generateId('usr'),
      role: 'user',
      content: userPrompt,
      pinned: this.behaviorConfig.enableInstructionAnchoring, // Survives context compression
    });

    // Reset plan for new request unless explicitly persisting
    if (!this.options.planId) {
      planState.reset();
    }

    // Proactive compression: trigger when usage exceeds threshold
    if (this.context.getApproximateTokens() > this.maxContextTokens * CONTEXT_CONSTANTS.CONTEXT_PROACTIVE_COMPRESSION_FACTOR) {
      await this.manageContext();
    }

    let iteration = 0;
    this.loopDetector.reset();
    this.lastThinkingText = '';
    this.thinkingOnlyIterations = 0;
    this.progressCallCount = 0;
    this.stateMachine.reset();
    this.idCounter = 0; // Better to reset idCounter at start of run if not already reset
    this.retryPolicy.resetAll();
    this.completeTaskRejectionCount = 0; // Reset safety valve count ON EACH RUN
    this.noVerificationRejectionCount = 0;

    // ============================================
    // ITERATION LOOP
    // ============================================
    while (iteration < this.maxIterations) {
      await this.manageContext();
      // 🟡 P2: compactThoughtSignatures disabled to protect prefix cache
      // this.compactThoughtSignatures(); 
      // Sync approximateTokens to actual visible context after manageContext
      this.context.updateTokens();
      const currentTokens = this.context.getApproximateTokens();
      console.log(`[AgentRuntime] --- Iteration Start: ${iteration}/${this.maxIterations} ---`);
      console.log(`[AgentRuntime] Context Budget: ${currentTokens}/${this.maxContextTokens} tokens (${Math.round(currentTokens/this.maxContextTokens*100)}%)`);
      console.log(`[AgentRuntime] Visible messages: ${this.context.getAllMessages().filter(m => !m.hidden).length}, Hidden: ${this.context.getMessages(true).length}`);

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
      const mode = this.stateMachine.determineNextMode(this.context);
      this.currentMode = mode; // Keep legacy sync for now
      const filteredTools = getToolsForMode(mode, this.options.tools);

      // ----------------------------------------
      // PHASE 2: SYSTEM PROMPT HOT-SWAP
      // ----------------------------------------
      await this.promptAssembler.hotSwapSystemPrompt(
        this.context.getAllMessages(),
        mode,
        this.originalUserRequest,
        this.operationLog
      );

      // ----------------------------------------
      // PHASE 3: DYNAMIC CONTEXT INJECTION
      // ----------------------------------------
      this.promptAssembler.injectDynamicContext(
        this.context.getAllMessages(),
        this.originalUserRequest,
        this.operationLog
      );

      // ----------------------------------------
      // PHASE 3: PREPARE LLM CALL
      // ----------------------------------------
      // System prompt is already in context (unshifted above)
      const visibleMessages = this.context.getMessages();
      // LOG VIZUALIZATION (Helpful for debugging loop recovery)
      if (this.thinkingOnlyIterations > 0) {
        console.log(`[AgentRuntime] 🔄 Loop Recovery Active. Context: ${this.context.getMessages().map(m => m.role).join(' -> ')}`);
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
      // - EXECUTION/VERIFICATION/RECOVERY with ANY mode: NO stream abort (tool calls come AFTER text)
      // - Other modes: default threshold
      const isThinkingModel = this.behaviorConfig.thinkingLevel !== 'minimal';
      const resolvedToolMode = getToolModeForPhase(mode, this.loopPolicy, this.stateMachine.state.consecutiveToolFailures, isThinkingModel);
      const isAnyToolMode = resolvedToolMode === 'ANY';
      const ramblingThreshold = mode === 'PLANNING'
        ? AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD * this.loopPolicy.planningRamblingMultiplier
        : isAnyToolMode
          ? Infinity  // [FIX] NEVER abort stream in ANY mode - tool calls arrive LAST
          : AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD;

      const toolConfig = { mode: resolvedToolMode };
      const actionMaxTokens = getMaxTokensForPhase(mode, this.loopPolicy);
      const effectiveThinkingLevel = this.getThinkingLevelForMode(mode);

      let currentIterationText = '';
      const allowProgressStreaming = mode === 'PLANNING';
      let toolCallsForExecution: LLMToolCall[] = [];
      let rawToolCallsForLoopDetection: LLMToolCall[] = []; // Pre-batch calls for stable fingerprinting
      try {
        response = await this.options.provider.generate({
          messages: this.context.getMessages(),
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
          thinkingLevel: effectiveThinkingLevel
        });

        let rawToolCalls = response.toolCalls || [];

        // Save raw (pre-batch) tool calls for loop detection — these have stable signatures
        // because they don't contain auto-generated opIds from buildBatchOperationsCall.
        rawToolCallsForLoopDetection = [...rawToolCalls];

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
              content: 'Your previous tool call had invalid syntax. Please emit a simpler, single tool call with valid JSON arguments. Use createNode, applyDesignPatch, or generateDesign.'
            };
            this.context.getAllMessages().push(recoveryHint);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
          iteration = Math.max(0, iteration - 1); // BUG-4 fix: prevent negative iteration
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

      // Safety check for empty responses — retry before giving up (Gemini 3.x Pro can intermittently return empty streams)
      if (!response.text && (!response.toolCalls || response.toolCalls.length === 0) && !response.thoughts) {
        this.emptyResponseRetries = (this.emptyResponseRetries || 0) + 1;
        const MAX_EMPTY_RETRIES = 2;
        if (this.emptyResponseRetries <= MAX_EMPTY_RETRIES) {
          console.warn(`[AgentRuntime] ⚠️ Empty response detected (retry ${this.emptyResponseRetries}/${MAX_EMPTY_RETRIES}). Retrying iteration ${iteration}...`);
          iteration = Math.max(0, iteration - 1); // BUG-4 fix: prevent negative iteration
          continue;
        }
        throw new Error('LLM Provider returned an empty response after retries. This usually indicates a generation failure.');
      }
      this.emptyResponseRetries = 0; // Reset on successful response

      // BUG-2 fix: Fire onIteration AFTER empty-response check to avoid
      // recording duplicate token entries for retried iterations.
      const activeTask = planState.getActiveStep();
      const taskInfo = activeTask ? { taskId: activeTask.stepId, taskTitle: activeTask.title } : undefined;
      this.options.onIteration?.(iteration, response, taskInfo);

      // Thinking-only iteration detection: catch "rambling" without action
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const textLength = (response.text || '').length;

        // [FIX] Special case: ANY mode should ALWAYS return tool calls.
        // If it didn't, something went seriously wrong (API bug, stream corruption, etc.)
        // RETRY IMMEDIATELY instead of just counting - don't waste an iteration
        if (isAnyToolMode && textLength > AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD) {
          this.anyModeRetryCount = (this.anyModeRetryCount || 0) + 1;
          console.error(`[AgentRuntime] 🚨 CRITICAL: ANY mode returned NO tool calls! Retry ${this.anyModeRetryCount}/${this.loopPolicy.anyModeNoToolRetryLimit}`);
          console.error(`[AgentRuntime] Response text length: ${textLength}, toolConfig was: ${JSON.stringify(toolConfig)}`);

          if (this.anyModeRetryCount <= this.loopPolicy.anyModeNoToolRetryLimit) {
            // Inject a stronger recovery message and retry this iteration
            const forceToolMessage: LLMMessage = {
              id: this.generateId('force'),
              role: 'user',
              content: `CRITICAL ERROR: You generated ${textLength} characters of text but ZERO tool calls. This violates the ANY mode constraint. You MUST call a tool NOW. Pick ONE: createNode, setNodeLayout, setNodeStyles, updateNodeProperties, or complete_task. Do NOT write any more text - just call the tool.`
            };
            this.context.getAllMessages().push(forceToolMessage);
            console.warn(`[AgentRuntime] 🔄 Retrying iteration ${iteration} with forced tool call message`);
            iteration = Math.max(0, iteration - 1); // BUG-4 fix: prevent negative iteration
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
        this.textOnlyCompletionRetries = 0;
      }

      // Add model's response to history
      const modelMessage = this.options.provider.formatResponse(response);
      modelMessage.id = this.generateId('mdl');

      // 🟡 P2: append-only recovery (removed logic that hid model messages)
// This text pollutes context (50K-70K tokens over 14 iterations) and reinforces the narration pattern.
      // By removing text parts, we keep only functional content (tool calls + thoughts) in context.
      if ((mode === 'EXECUTION' || mode === 'VERIFICATION' || mode === 'RECOVERY') && response.toolCalls && response.toolCalls.length > 0) {
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
      
      this.context.addMessage(modelMessage);
      
      console.log(`[AgentRuntime] 📊 Model message added. Total visible: ${this.context.getApproximateTokens()} tokens`);

      // ----------------------------------------
      // PHASE 5: TOOL EXECUTION
      // ----------------------------------------
      if (toolCallsForExecution.length > 0) {
        const workflowResults: import('../llm-client/providers/types').LLMToolResult[] = [];
        const figmaToolCalls: LLMToolCall[] = [];

        for (const tc of toolCallsForExecution) {
          if (tc.name === 'planDesign') {
            const stepsWithIds = (tc.args.steps || []).map((step: any, idx: number) => ({
              ...step,
              stepId: step.stepId || `step_${Date.now()}_${idx}`,
              status: 'pending'
            }));
            planState.setCurrentPlan(stepsWithIds);
            workflowResults.push({
              name: tc.name, id: tc.id, response: { success: true, data: { acknowledged: true, steps: stepsWithIds } },
              thought_signature: tc.thought_signature
            });
          } else if (tc.name === 'complete_step') {
            const activeStep = planState.getActiveStep();
            if (activeStep) {
              planState.completeTask(activeStep.stepId, tc.args.summary || 'Step completed');
              workflowResults.push({
                name: tc.name, id: tc.id, response: { success: true, message: `Step "${activeStep.title}" completed.` },
                thought_signature: tc.thought_signature
              });
            } else {
              workflowResults.push({ name: tc.name, id: tc.id, response: { success: false, error: { code: 'NO_ACTIVE_STEP' } }, thought_signature: tc.thought_signature });
            }
          } else if (tc.name === 'complete_task') {
            if (this.hasPendingToolErrors) {
              workflowResults.push({ name: tc.name, id: tc.id, response: { success: false, error: { code: 'PENDING_TOOL_ERRORS' } }, thought_signature: tc.thought_signature });
            } else if (!this.stateMachine.state.hasPerformedVerificationInspect && this.options.loopPolicy?.useSkillSystem !== false) {
              if (this.noVerificationRejectionCount >= 1) {
                this.options.onToolCall?.(tc);
                return tc.args.summary;
              }
              this.noVerificationRejectionCount++;
              workflowResults.push({
                name: tc.name, id: tc.id, response: { success: false, error: { code: 'NO_VERIFICATION', message: 'Call inspectDesign first.' } },
                thought_signature: tc.thought_signature
              });
            } else {
              this.options.onToolCall?.(tc);
              return tc.args.summary;
            }
          } else if (['new_task', 'update_todo_list', 'summarize_progress'].includes(tc.name)) {
            workflowResults.push({ name: tc.name, id: tc.id, response: { success: true }, thought_signature: tc.thought_signature });
          } else {
            figmaToolCalls.push(tc);
          }
        }

        const toolResults: import('../llm-client/providers/types').LLMToolResult[] = [...workflowResults];
        const loopDetectionCalls = rawToolCallsForLoopDetection.length > 0
          ? rawToolCallsForLoopDetection
          : toolCallsForExecution;
        const loopResult = this.loopDetector.detect(loopDetectionCalls, {
          identical: AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD,
          monotone: this.loopPolicy.monotoneLoopThreshold
        });
        if (loopResult) {
          if (loopResult.fatal) {
            throw new Error(loopResult.message);
          }
          this.context.addMessage({
            id: this.generateId('mono_loop'),
            role: 'user',
            content: loopResult.hint || loopResult.message
          });
        }

        if (figmaToolCalls.length > 0) {
          const results = await this.executeFigmaTools(figmaToolCalls);
          toolResults.push(...results);
          
          this.hasPendingToolErrors = this.stateMachine.handleFigmaToolResults(
            figmaToolCalls, results, this.context.getAllMessages()
          );
          
          this.stateMachine.updateStateFromToolResults(results);
          this.stateMachine.handleVerificationFixLoop(results, this.context.getAllMessages());
        }

        const toolResultsMessage = this.options.provider.formatToolResults(toolResults);
        toolResultsMessage.id = this.generateId('tol');
        this.context.addMessage(toolResultsMessage);

        iteration++;
        continue;
      } else {
        if (this.textOnlyCompletionRetries < AGENT_RUNTIME_CONSTANTS.MAX_TEXT_ONLY_COMPLETION_RETRIES) {
          this.textOnlyCompletionRetries++;
          this.context.addMessage({
            id: this.generateId('nudge'), role: 'user', content: 'Call complete_task to signal completion.'
          });
          iteration = Math.max(0, iteration - 1); // BUG-4 fix: prevent negative iteration
          continue;
        }
        return response.text;
      }
    }

    throw new Error(`Maximum iterations (${this.maxIterations}) reached.`);
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
      // Fast-fail validation for empty props or missing required arguments
      ToolValidator.validate(tc);

      if (toolExec) {
        return await toolExec(tc.args);
      } else if (this.options.ipcBridge) {
        return await this.options.ipcBridge.callTool(tc.name, tc.args);
      } else {
        return { success: false, error: { code: 'NO_TOOL_EXECUTOR', message: `No executor found for tool '${tc.name}'` } };
      }
    } catch (e: any) {
      const isValidationError = e?.message?.includes('Validation Error');
      return { 
        success: false, 
        error: { 
          code: isValidationError ? 'TOOL_VALIDATION_ERROR' : 'TOOL_EXEC_EXCEPTION', 
          message: e.message 
        } 
      };
    }
  }

  /**
   * Clean and truncate tool results to prevent context explosion.
   * Tool results with large data payloads can consume excessive tokens.
   */
  private cleanToolResult(result: any, toolName?: string): any {
    return this.cleaner.cleanToolResult({ ...result, ...(toolName && { name: toolName }) });
  }

  public getMessages(): LLMMessage[] {
    return this.context.getAllMessages();
  }

  /**
   * Executes a list of Figma tools sequentially or in parallel based on strategy.
   */
  private async executeFigmaTools(calls: LLMToolCall[]): Promise<import('../llm-client/providers/types').LLMToolResult[]> {
    const results: import('../llm-client/providers/types').LLMToolResult[] = [];
    
    // Group tool calls by strategy
    const groups: { strategy: 'parallel' | 'sequential', calls: LLMToolCall[] }[] = [];
    for (const tc of calls) {
      const toolDef = this.options.tools.find(t => t.name === tc.name);
      const strategy = toolDef?.executionStrategy || 'sequential';
      if (groups.length > 0 && groups[groups.length - 1].strategy === strategy) {
        groups[groups.length - 1].calls.push(tc);
      } else {
        groups.push({ strategy, calls: [tc] });
      }
    }

    for (const group of groups) {
      if (group.strategy === 'parallel') {
        const parallelResults = await Promise.all(group.calls.map(async (tc) => {
          this.options.onToolCall?.(tc);
          const res = await this.executeToolWithTimeout(tc);
          this.options.onToolResult?.(tc, res);
          return {
            name: tc.name,
            id: tc.id,
            response: this.cleanToolResult(res, tc.name),
            thought_signature: tc.thought_signature
          };
        }));
        results.push(...parallelResults);
      } else {
        for (const tc of group.calls) {
          this.options.onToolCall?.(tc);
          const res = await this.executeToolWithTimeout(tc);
          this.options.onToolResult?.(tc, res);
          results.push({
            name: tc.name,
            id: tc.id,
            response: this.cleanToolResult(res, tc.name),
            thought_signature: tc.thought_signature
          });
        }
      }
    }
    return results;
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
