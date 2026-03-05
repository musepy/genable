/**
 * @file agentRuntime.ts
 * @description Autonomous agent runtime. Pure dispatch loop — the LLM decides
 * what tools to call and when to stop. Safety guardrails run as composable
 * hooks via the HookRegistry → HookRunner pipeline.
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMToolCall } from '../llm-client/providers/types';
import { ToolDefinition, ToolParameter } from './tools';
import { AgentBehaviorConfig, resolveBehavior } from './agentBehaviorConfig';
import { AgentLoopPolicy, resolveAgentLoopPolicy, ToolCallMode } from './agentLoopPolicy';
import { HookRegistry, HookRunner, createBuiltinHooksWithState } from './hooks';
import type { HookRegistration, HookContext } from './hooks';
import { ToolResultCleaner } from './context/toolResultCleaner';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { CONTEXT_CONSTANTS } from './context/constants';
import {
  dropRedundantToolErrors,
  truncateByTurns,
  fixInvalidSequence,
  validateMessageSequence,
  groupIntoTurns,
} from './context/contextCompression';
import { AgentRuntimeEvent } from '../../shared/protocol/agentRuntimeEvents';
import { ToolExecutionCoordinator } from './tools/toolExecutionCoordinator';
import { LLMGenerationCoordinator } from './llmGenerationCoordinator';
import { ToolDispatcher } from './toolDispatcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuntimeEventPayload {
  type: AgentRuntimeEvent['type'];
  [key: string]: any;
}

export interface AgentRuntimeOptions {
  provider: LLMProvider;
  tools: ToolDefinition[];
  ipcBridge?: import('./ipcBridge').IpcBridge;
  maxIterations?: number;
  maxContextTokens?: number;
  systemPrompt?: string;
  behaviorConfig?: Partial<AgentBehaviorConfig>;
  onToolCall?: (toolCall: LLMToolCall) => void;
  onToolResult?: (toolCall: LLMToolCall, result: any) => void;
  onIterationStart?: (iteration: number, taskInfo?: { taskId: string; taskTitle: string }) => void;
  onIteration?: (iteration: number, response: LLMResponse, taskInfo?: { taskId: string; taskTitle: string }) => void;
  taskId?: string;
  taskTitle?: string;
  toolExecutors?: Record<string, import('./tools/types').ToolExecutor>;
  messages?: LLMMessage[];
  loopPolicy?: Partial<AgentLoopPolicy>;
  onRuntimeEvent?: (event: AgentRuntimeEvent) => void;
  /** Custom hooks. If omitted, builtin safety hooks are registered by default. */
  hooks?: HookRegistration[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AgentRuntimeCanceledError extends Error {
  public readonly code = 'AGENT_CANCELED';

  constructor(message: string = 'Canceled by user') {
    super(message);
    this.name = 'AgentRuntimeCanceledError';
  }
}

// ---------------------------------------------------------------------------
// AgentRuntime — Autonomous dispatch loop
// ---------------------------------------------------------------------------

export class AgentRuntime {
  private maxIterations: number;
  private maxContextTokens: number;
  private messages: LLMMessage[] = [];
  private lastPromptTokens: number = 0;

  private cleaner: ToolResultCleaner;
  private toolExecutionCoordinator = new ToolExecutionCoordinator();
  private llmCoordinator: LLMGenerationCoordinator;
  private toolDispatcher: ToolDispatcher;
  private allowedExecutionToolNames: Set<string>;
  private idCounter: number = 0;
  private readonly THROTTLE_MS = 100;
  private hookRegistry: HookRegistry;
  private hookRunner: HookRunner;
  private resetBuiltinState: (() => void) | null = null;
  systemPrompt?: string;
  behaviorConfig: AgentBehaviorConfig;
  loopPolicy: AgentLoopPolicy;
  private originalUserRequest: string = '';
  private canceled = false;
  private cancelReason = 'Canceled by user';
  private activeAbortController: AbortController | null = null;
  private currentRunId = '';
  private eventSequence = 0;
  private canceledEventEmitted = false;
  private runStats = {
    toolCallCount: 0, toolErrorCount: 0, loopDetected: false,
    tokenUsage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, callCount: 0 },
  };

  constructor(private options: AgentRuntimeOptions) {

    this.behaviorConfig = resolveBehavior(options.behaviorConfig);
    this.loopPolicy = resolveAgentLoopPolicy(options.loopPolicy);
    this.maxIterations = options.maxIterations || this.behaviorConfig.maxIterations;
    this.maxContextTokens = options.maxContextTokens || AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_CONTEXT_TOKENS;
    this.cleaner = new ToolResultCleaner(options.tools);
    this.llmCoordinator = new LLMGenerationCoordinator(
      options.provider,
      this.cleaner,
      {
        thinkingTimeoutMs: AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS,
        throttleMs: this.THROTTLE_MS,
        generateId: (prefix) => this.generateId(prefix),
        normalizeToolCallId: (tc, fallbackPrefix) => this.normalizeToolCallId(tc, fallbackPrefix),
        emitRuntimeEvent: (event) => this.emitRuntimeEvent(event as RuntimeEventPayload),
        throwIfCanceled: (iteration) => this.throwIfCanceled(iteration),
      },
    );
    this.allowedExecutionToolNames = new Set(options.tools.map((tool) => tool.name));
    this.toolDispatcher = new ToolDispatcher(
      options.toolExecutors || {},
      options.ipcBridge,
      this.toolExecutionCoordinator,
      this.cleaner,
      this.allowedExecutionToolNames,
      {
        toolTimeoutMs: AGENT_RUNTIME_CONSTANTS.DEFAULT_TOOL_TIMEOUT_MS,
        generateId: (prefix) => this.generateId(prefix),
        normalizeToolCallId: (tc, fallbackPrefix) => this.normalizeToolCallId(tc, fallbackPrefix),
        emitRuntimeEvent: (event) => this.emitRuntimeEvent(event as RuntimeEventPayload),
        throwIfCanceled: (iteration) => this.throwIfCanceled(iteration),
        onToolCall: options.onToolCall,
        onToolResult: options.onToolResult,
        formatToolResults: (results) => options.provider.formatToolResults(results),
        getRunId: () => this.currentRunId,
      },
    );
    // Seed messages: static system prompt at index 0
    // No dynamic context message — keeping the prefix stable enables KV-cache
    // reuse across iterations (every message after sys_static is append-only).
    const seedMessages: LLMMessage[] = [];
    if (options.systemPrompt) {
      seedMessages.push({
        id: 'sys_static',
        role: 'system',
        content: options.systemPrompt,
      });
    }
    if (options.messages) {
      seedMessages.push(...options.messages);
    }
    this.messages = [...seedMessages];

    // Hook system — builtin hooks by default, custom hooks override
    this.hookRegistry = new HookRegistry();
    if (options.hooks) {
      this.hookRegistry.registerAll(options.hooks);
    } else {
      const { hooks, reset } = createBuiltinHooksWithState();
      this.hookRegistry.registerAll(hooks);
      this.resetBuiltinState = reset;
    }
    this.hookRunner = new HookRunner(this.hookRegistry);

    // Disable throttling in tests
    if (process.env.NODE_ENV === 'test') {
      (this as any).THROTTLE_MS = 0;
    }
  }

  // ─── Cancel ──────────────────────────────────────────────────

  public cancel(reason: string = 'Canceled by user'): void {
    this.canceled = true;
    this.cancelReason = reason;
    if (this.activeAbortController && !this.activeAbortController.signal.aborted) {
      this.activeAbortController.abort();
    }
    this.emitCanceledEvent();
  }

  // ─── Events ──────────────────────────────────────────────────

  private emitRuntimeEvent(event: RuntimeEventPayload): void {
    if (!this.options.onRuntimeEvent) return;
    this.eventSequence += 1;
    const full = {
      ...event,
      runId: this.currentRunId || 'run_unknown',
      sequence: this.eventSequence,
      timestamp: Date.now(),
    } as AgentRuntimeEvent;
    if (event.type === 'tool_call') {
      const tc = (event as any).toolCall;
      console.log(`[RuntimeEvent] tool_call: ${tc?.name}(${JSON.stringify(tc?.args || {})})`)
    } else if (event.type === 'tool_result') {
      const tr = (event as any).toolResult;
      const lineResults = tr?.raw?.data?.lineResults;
      const failSuffix = !tr?.success && lineResults
        ? (() => {
            const lrs = lineResults as any[];
            const failed = lrs.filter((r: any) => r.status === 'failed');
            const skipped = lrs.filter((r: any) => r.status === 'skipped');
            const firstErr = failed[0];
            return ` [${failed.length}F/${skipped.length}S/${lrs.length}T] first: ${firstErr?.error ?? tr?.error ?? '?'}`;
          })()
        : !tr?.success && tr?.error
          ? ` — ${typeof tr.error === 'string' ? tr.error : tr.error.message ?? JSON.stringify(tr.error)}`
          : '';
      console.log(`[RuntimeEvent] tool_result: ${tr?.name} ${tr?.success ? 'ok' : 'FAIL'} (${tr?.durationMs}ms)${failSuffix}`);
    }
    this.options.onRuntimeEvent(full);
  }

  private emitCanceledEvent(iteration?: number): void {
    if (this.canceledEventEmitted) return;
    this.emitRuntimeEvent({
      type: 'canceled',
      phase: 'execution',
      iteration,
      reason: this.cancelReason,
    });
    this.canceledEventEmitted = true;
  }

  private throwIfCanceled(iteration?: number): void {
    if (!this.canceled) return;
    this.emitCanceledEvent(iteration);
    throw new AgentRuntimeCanceledError(this.cancelReason);
  }

  // ─── ID generation ───────────────────────────────────────────

  private normalizeToolCallId(tc: LLMToolCall, fallbackPrefix = 'tool'): string {
    if (typeof tc.id === 'string' && tc.id.trim().length > 0) return tc.id;
    return this.generateId(fallbackPrefix);
  }

  private generateId(prefix: string): string {
    this.idCounter++;
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 5);
    return `${prefix}_${timestamp}${random}${this.idCounter}`;
  }

  // ─── Sanitization ────────────────────────────────────────────

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

  // ─── Context management ──────────────────────────────────────

  private async manageContext(): Promise<void> {
    // First iteration: lastPromptTokens is 0 → skip (correct: context is small)
    if (this.lastPromptTokens === 0) return;

    const threshold = this.maxContextTokens * CONTEXT_CONSTANTS.CONTEXT_COMPRESSION_LIMIT_FACTOR;
    if (this.lastPromptTokens <= threshold) return;

    // 1. Drop redundant error messages
    dropRedundantToolErrors(this.messages);

    // 2. Turn-based truncation — hide oldest turns
    const excessRatio = this.lastPromptTokens / threshold;
    const turnsToHide = Math.max(1, Math.floor(excessRatio - 1) + 1);
    truncateByTurns(this.messages, turnsToHide);

    // 3. Validate & fix sequence
    const validation = validateMessageSequence(this.messages);
    if (!validation.valid) {
      console.warn('[AgentRuntime] Invalid sequence after truncation, fixing...', validation.error);
      fixInvalidSequence(this.messages);
    }

    // 4. Proactive summarization if still heavily over budget
    if (this.lastPromptTokens > this.maxContextTokens) {
      await this.summarizeConversation();
    }
  }

  private async summarizeConversation(): Promise<void> {
    const turns = groupIntoTurns(this.messages);
    if (turns.length < 4) return;

    const turnsToSummarize = turns.slice(0, Math.floor(turns.length / 2));
    const allIndicesToHide: number[] = [];
    for (const turn of turnsToSummarize) {
      allIndicesToHide.push(...turn.indices);
    }
    if (allIndicesToHide.length === 0) return;

    const messagesToSummarize = allIndicesToHide.map(idx => this.messages[idx]);

    // Build summary prompt
    const strippedMessages = messagesToSummarize.map(m => {
      let contentStr = '';
      if (typeof m.content === 'string') {
        contentStr = m.content.substring(0, 500) + (m.content.length > 500 ? '...' : '');
      } else if (Array.isArray(m.content)) {
        contentStr = m.content.map((part: any) => {
          if (part.functionCall) return `[Call: ${part.functionCall.name}]`;
          if (part.functionResponse) return `[Result: ${part.functionResponse.name}]`;
          return '[Part]';
        }).join(' ');
      }
      return `${m.role.toUpperCase()}: ${contentStr}`;
    });

    const summaryPrompt = `Please summarize the following Figma plugin design steps briefly in 1-2 sentences. Focus on what was built or changed. Example: "Created the layout structure and added a submit button."\n\nHistory:\n${strippedMessages.join('\n')}`;

    let summaryText: string;
    try {
      const response = await this.options.provider.generate({
        messages: [{ id: `sum_req_${Date.now()}`, role: 'user', content: summaryPrompt }],
        maxTokens: 150,
        thinkingLevel: 'minimal'
      });
      summaryText = response.text || 'Conversation summarized.';
    } catch (error) {
      console.warn('[AgentRuntime] Summarizer failed, using fallback summary.', error);
      summaryText = 'Several design steps completed.';
    }

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
      pinned: true,
    };

    this.messages.splice(insertIdx, 0, summaryMessage);
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN AGENT LOOP — Autonomous dispatch
  //
  // STRUCTURE:
  // 1. Setup: Add user message, build system prompt
  // 2. Loop:
  //    a. Context management
  //    b. LLM generate (all tools available, AUTO mode)
  //    c. Tool execution (dispatch to executors)
  //    d. Safety guardrails (loop detection, rambling, token limit)
  // 3. Termination: completion signal or max iterations
  // ═══════════════════════════════════════════════════════════════

  async run(userPrompt: string): Promise<string> {
    this.currentRunId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    this.eventSequence = 0;
    this.canceledEventEmitted = false;
    this.activeAbortController = null;
    this.canceled = false;
    this.cancelReason = 'Canceled by user';
    this.originalUserRequest = userPrompt;

    this.messages.push({
      id: this.generateId('usr'),
      role: 'user',
      content: userPrompt,
      pinned: this.behaviorConfig.enableInstructionAnchoring,
    });

    // Proactive compression on resume (only if we have real token data from a previous run)
    if (this.lastPromptTokens > this.maxContextTokens * CONTEXT_CONSTANTS.CONTEXT_PROACTIVE_COMPRESSION_FACTOR) {
      await this.manageContext();
    }

    let iteration = 0;
    this.resetBuiltinState?.();
    this.llmCoordinator.reset();
    this.idCounter = 0;
    this.runStats = {
      toolCallCount: 0, toolErrorCount: 0, loopDetected: false,
      tokenUsage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, callCount: 0 },
    };

    this.emitRuntimeEvent({
      type: 'status',
      phase: 'execution',
      message: 'Agent starting...',
      iteration: 0,
      maxIterations: this.maxIterations,
    });

    // ════════════════════════════════════════════
    // ITERATION LOOP
    // ════════════════════════════════════════════
    while (iteration < this.maxIterations) {
      this.throwIfCanceled(iteration + 1);
      await this.manageContext();
      this.throwIfCanceled(iteration + 1);
      const currentTokens = this.lastPromptTokens;
      const visibleMessageCount = this.messages.filter(m => !m.hidden).length;
      const hiddenMessages = this.messages.length;
      this.emitRuntimeEvent({
        type: 'context_usage',
        iteration: iteration + 1,

        phase: 'execution',
        usage: {
          current: currentTokens,
          max: this.maxContextTokens,
          percent: currentTokens > 0 ? Math.round((currentTokens / this.maxContextTokens) * 100) : 0,
          visibleMessages: visibleMessageCount,
          hiddenMessages
        }
      });

      // Hard stop: token budget overflow (only when we have real token data)
      if (currentTokens > 0 && currentTokens > this.maxContextTokens * 1.2) {
        console.error(`[AgentRuntime] FATAL: Context budget exceeded 120%. Aborting.`);
        throw new Error(`Agent aborted: context budget exceeded 120% (${Math.round(currentTokens/this.maxContextTokens*100)}%).`);
      }

      // Lazy iteration start notification
      let hasNotifiedIterationStart = false;
      const notifyIterationStartOnce = () => {
        if (!hasNotifiedIterationStart) {
          this.options.onIterationStart?.(iteration);
          hasNotifiedIterationStart = true;
        }
      };

      this.emitRuntimeEvent({
        type: 'iteration_start',
        iteration: iteration + 1,
        maxIterations: this.maxIterations,

        phase: 'execution',
      });

      // ──── LLM GENERATION ────
      const abortController = new AbortController();
      this.activeAbortController = abortController;
      const timeoutId = setTimeout(() => {
        console.warn(`[AgentRuntime] Thinking timeout — aborting stream`);
        abortController.abort();
      }, AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS);

      let toolCallsForExecution: LLMToolCall[] = [];
      let rawToolCallsForLoopDetection: LLMToolCall[] = [];
      let response: LLMResponse;

      try {
        this.llmCoordinator.config.notifyIterationStart = notifyIterationStartOnce;
        const genResult = await this.llmCoordinator.generate(
          {
            messages: this.messages.filter(m => !m.hidden),
            tools: this.options.tools,
            toolConfig: { mode: 'AUTO' as ToolCallMode },
            maxOutputTokens: this.loopPolicy.maxOutputTokens,
            thinkingLevel: this.behaviorConfig.thinkingLevel,
            iteration,
            maxIterations: this.maxIterations,
          },
          abortController,
        );
        response = genResult.response;
        toolCallsForExecution = genResult.toolCallsForExecution;
        rawToolCallsForLoopDetection = genResult.rawToolCallsForLoopDetection;
      } catch (error: any) {
        if (this.canceled || abortController.signal.aborted) {
          this.throwIfCanceled(iteration + 1);
        }
        // Non-retryable or all retries exhausted — bubble up
        throw error;
      } finally {
        clearTimeout(timeoutId);
        this.activeAbortController = null;
      }

      // Ensure iteration start was notified
      if (response.text || (response.toolCalls && response.toolCalls.length > 0)) {
        notifyIterationStartOnce();
      }

      // ──── HOOK: afterLLMResponse ────
      // Replaces inline empty-response guard, rambling detection, and loop detection.
      const hookCtx: HookContext = {
        iteration,
        maxIterations: this.maxIterations,
        responseText: response.text,
        toolCalls: rawToolCallsForLoopDetection.length > 0 ? rawToolCallsForLoopDetection : toolCallsForExecution,
        messages: this.messages,
        loopPolicy: this.loopPolicy,
        generateId: (prefix) => this.generateId(prefix),
      };
      const hookResult = await this.hookRunner.run('afterLLMResponse', hookCtx);

      if (hookResult.action === 'abort') {
        throw new Error(hookResult.reason || 'Aborted by hook');
      }
      if (hookResult.action === 'skip') {
        // Skip this iteration (e.g. empty response retry)
        iteration = Math.max(0, iteration - 1);
        continue;
      }

      // Track loop detection in runStats
      if (hookResult.injectMessage && typeof hookResult.injectMessage === 'string'
        && (hookResult.injectMessage.includes('repeated') || hookResult.injectMessage.includes('consecutive iterations'))) {
        this.runStats.loopDetected = true;
      }

      // Fire onIteration callback
      this.options.onIteration?.(iteration, response);
      this.throwIfCanceled(iteration + 1);

      // ──── ADD MODEL RESPONSE TO HISTORY ────
      const modelMessage = this.options.provider.formatResponse(response);
      modelMessage.id = this.generateId('mdl');

      this.messages.push(modelMessage);

      // Track real prompt tokens from LLM response
      this.lastPromptTokens = response.usage?.promptTokens ?? this.lastPromptTokens;
      if (response.usage) {
        this.runStats.tokenUsage.totalPromptTokens += response.usage.promptTokens;
        this.runStats.tokenUsage.totalCompletionTokens += response.usage.completionTokens;
        this.runStats.tokenUsage.totalTokens += response.usage.totalTokens;
        this.runStats.tokenUsage.callCount++;
      }

      // ──── TOOL EXECUTION ────
      if (toolCallsForExecution.length > 0) {
        this.runStats.toolCallCount += toolCallsForExecution.length;
        const dispatchResult = await this.toolDispatcher.dispatch(toolCallsForExecution, iteration);
        // Count tool errors from the result message
        const content = dispatchResult.toolResultsMessage.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part.functionResponse?.response?.success === false) {
              this.runStats.toolErrorCount++;
            }
          }
        }
        this.messages.push(dispatchResult.toolResultsMessage);
        iteration++;
        continue;
      } else {
        // Implicit completion: no tool calls = agent is done.
        // The LLM's text response is the completion summary.
        this.emitRuntimeEvent({
          type: 'completed',
          phase: 'execution',
          iteration: iteration + 1,
          totalIterations: iteration + 1,
          summary: response.text || 'Completed',
        });
        return response.text;
      }
    }

    throw new Error(`Maximum iterations (${this.maxIterations}) reached.`);
  }

  public getMessages(): LLMMessage[] {
    return this.messages;
  }

  public getRunStats() {
    return { ...this.runStats };
  }

  public getRunId(): string {
    return this.currentRunId;
  }
}
