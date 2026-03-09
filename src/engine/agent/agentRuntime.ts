/**
 * @file agentRuntime.ts
 * @description Autonomous agent runtime with layered context management.
 *
 * Context is structured in 3 layers, not a flat message array:
 *   1. systemPrompt  — static, set once at construction
 *   2. summary       — rolling summary of previous turns, updated at turn boundaries
 *   3. turnMessages  — current turn's messages, cleared at turn end
 *
 * This keeps context bounded and predictable regardless of conversation length.
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMToolCall } from '../llm-client/providers/types';
import { ToolDefinition, ToolParameter } from './tools';
import { AgentBehaviorConfig, resolveBehavior } from './agentBehaviorConfig';
import { AgentLoopPolicy, resolveAgentLoopPolicy, ToolCallMode } from './agentLoopPolicy';
import { HookRegistry, HookRunner, createBuiltinHooksWithState } from './hooks';
import type { HookRegistration, HookContext } from './hooks';
import { ToolResultCleaner } from './context/toolResultCleaner';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { buildCompressionSummary } from './context/contextSummarizer';
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
  systemPrompt?: string;
  behaviorConfig?: Partial<AgentBehaviorConfig>;
  onToolCall?: (toolCall: LLMToolCall) => void;
  onToolResult?: (toolCall: LLMToolCall, result: any) => void;
  onIterationStart?: (iteration: number, taskInfo?: { taskId: string; taskTitle: string }) => void;
  onIteration?: (iteration: number, response: LLMResponse, taskInfo?: { taskId: string; taskTitle: string }) => void;
  taskId?: string;
  taskTitle?: string;
  toolExecutors?: Record<string, import('./tools/types').ToolExecutor>;
  loopPolicy?: Partial<AgentLoopPolicy>;
  onRuntimeEvent?: (event: AgentRuntimeEvent) => void;
  hooks?: HookRegistration[];
  requireToolApproval?: boolean;
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
// AgentRuntime — Layered context, autonomous dispatch
// ---------------------------------------------------------------------------

export class AgentRuntime {
  private maxIterations: number;

  // ─── Layered context ───
  private readonly staticSystemPrompt: string;
  private summary: string = '';            // rolling summary of previous turns
  private turnMessages: LLMMessage[] = []; // current turn only, cleared at turn end

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
  behaviorConfig: AgentBehaviorConfig;
  loopPolicy: AgentLoopPolicy;
  private canceled = false;
  private cancelReason = 'Canceled by user';
  private activeAbortController: AbortController | null = null;
  private currentRunId = '';
  private eventSequence = 0;
  private canceledEventEmitted = false;
  private pendingApproval: { resolve: (approved: boolean) => void } | null = null;
  private runStats = {
    toolCallCount: 0, toolErrorCount: 0, loopDetected: false,
    tokenUsage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, callCount: 0 },
  };

  constructor(private options: AgentRuntimeOptions) {
    this.behaviorConfig = resolveBehavior(options.behaviorConfig);
    this.loopPolicy = resolveAgentLoopPolicy(options.loopPolicy);
    this.maxIterations = options.maxIterations || this.behaviorConfig.maxIterations;
    this.staticSystemPrompt = options.systemPrompt || '';
    this.cleaner = new ToolResultCleaner(options.tools);
    this.llmCoordinator = new LLMGenerationCoordinator(
      options.provider,
      this.cleaner,
      {
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

    // Hook system
    this.hookRegistry = new HookRegistry();
    if (options.hooks) {
      this.hookRegistry.registerAll(options.hooks);
    } else {
      const { hooks, reset } = createBuiltinHooksWithState();
      this.hookRegistry.registerAll(hooks);
      this.resetBuiltinState = reset;
    }
    this.hookRunner = new HookRunner(this.hookRegistry);

    if (process.env.NODE_ENV === 'test') {
      (this as any).THROTTLE_MS = 0;
    }
  }

  // ─── Cancel ──────────────────────────────────────────────────

  public cancel(reason: string = 'Canceled by user'): void {
    this.canceled = true;
    this.cancelReason = reason;
    if (this.pendingApproval) {
      this.pendingApproval.resolve(false);
      this.pendingApproval = null;
    }
    if (this.activeAbortController && !this.activeAbortController.signal.aborted) {
      this.activeAbortController.abort();
    }
    this.emitCanceledEvent();
  }

  public resolveApproval(approved: boolean): void {
    this.pendingApproval?.resolve(approved);
    this.pendingApproval = null;
  }

  public mergeToolExecutors(executors: Record<string, import('./tools/types').ToolExecutor>): void {
    this.toolDispatcher.mergeExecutors(executors);
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
      const failSuffix = !tr?.success && tr?.error
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

  // ─── Context assembly ─────────────────────────────────────────

  /**
   * Assemble the prompt from layered context.
   * Always bounded: system + summary + current turn messages.
   */
  private assemblePrompt(): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // Layer 1: static system prompt
    if (this.staticSystemPrompt) {
      messages.push({ id: 'sys_static', role: 'system', content: this.staticSystemPrompt });
    }

    // Layer 2: rolling summary of previous turns
    if (this.summary) {
      messages.push({ id: 'ctx_summary', role: 'user', content: this.summary });
    }

    // Layer 3: current turn messages
    messages.push(...this.turnMessages);

    return messages;
  }

  /**
   * Summarize the current turn and append to rolling summary.
   * turnMessages are NOT cleared here — they stay available for getMessages()
   * (used by debrief). They're cleared at the start of the next run().
   */
  private endTurn(): void {
    const turnSummary = buildCompressionSummary(this.turnMessages);
    if (turnSummary) {
      this.summary = this.summary
        ? `${this.summary}\n${turnSummary}`
        : turnSummary;
      console.log(`[Context] Turn summarized (${turnSummary.length} chars). Total summary: ${this.summary.length} chars`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN AGENT LOOP
  // ═══════════════════════════════════════════════════════════════

  async run(userPrompt: string): Promise<string> {
    this.currentRunId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    this.eventSequence = 0;
    this.canceledEventEmitted = false;
    this.activeAbortController = null;
    this.canceled = false;
    this.cancelReason = 'Canceled by user';

    // Clear previous turn (its summary is already in this.summary)
    this.turnMessages = [];

    // Add user message to current turn
    this.turnMessages.push({
      id: this.generateId('usr'),
      role: 'user',
      content: userPrompt,
    });

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

      const prompt = this.assemblePrompt();
      const currentTokens = this.lastPromptTokens;

      // Debug: dump full LLM prompt for each iteration (visible in Figma DevTools Console)
      console.log(`\n${'='.repeat(60)}\n[Iteration ${iteration + 1}/${this.maxIterations}] LLM Prompt (${prompt.length} messages)\n${'='.repeat(60)}`);
      for (const m of prompt) {
        const contentPreview = typeof m.content === 'string'
          ? m.content.slice(0, 500)
          : Array.isArray(m.content)
            ? (m.content as any[]).map((p: any) => {
                if (p.text) return `[text] ${p.text.slice(0, 200)}`;
                if (p.functionCall) return `[call] ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 200)})`;
                if (p.functionResponse) return `[result] ${p.functionResponse.name}: ${JSON.stringify(p.functionResponse.response).slice(0, 200)}`;
                return '[other]';
              }).join('\n    ')
            : '(empty)';
        console.log(`  [${m.role}] ${m.id}: ${contentPreview}`);
      }
      console.log('='.repeat(60));

      this.emitRuntimeEvent({
        type: 'context_usage',
        iteration: iteration + 1,
        phase: 'execution',
        usage: {
          current: currentTokens,
          max: AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_CONTEXT_TOKENS,
          percent: currentTokens > 0 ? Math.round((currentTokens / AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_CONTEXT_TOKENS) * 100) : 0,
          visibleMessages: prompt.length,
          hiddenMessages: 0,
        }
      });

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
        console.warn(`[AgentRuntime] Total generation budget exceeded — aborting`);
        abortController.abort();
      }, AGENT_RUNTIME_CONSTANTS.TOTAL_GENERATION_BUDGET_MS);

      let toolCallsForExecution: LLMToolCall[] = [];
      let rawToolCallsForLoopDetection: LLMToolCall[] = [];
      let response: LLMResponse;

      try {
        this.llmCoordinator.config.notifyIterationStart = notifyIterationStartOnce;
        const genResult = await this.llmCoordinator.generate(
          {
            messages: prompt,
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
        throw error;
      } finally {
        clearTimeout(timeoutId);
        this.activeAbortController = null;
      }

      if (response.text || (response.toolCalls && response.toolCalls.length > 0)) {
        notifyIterationStartOnce();
      }

      // ──── HOOK: afterLLMResponse ────
      const hookCtx: HookContext = {
        iteration,
        maxIterations: this.maxIterations,
        responseText: response.text,
        toolCalls: rawToolCallsForLoopDetection.length > 0 ? rawToolCallsForLoopDetection : toolCallsForExecution,
        messages: this.turnMessages,
        loopPolicy: this.loopPolicy,
        generateId: (prefix) => this.generateId(prefix),
      };
      const hookResult = await this.hookRunner.run('afterLLMResponse', hookCtx);

      if (hookResult.action === 'abort') {
        throw new Error(hookResult.reason || 'Aborted by hook');
      }
      if (hookResult.action === 'skip') {
        iteration = Math.max(0, iteration - 1);
        continue;
      }

      if (hookResult.injectMessage && typeof hookResult.injectMessage === 'string'
        && (hookResult.injectMessage.includes('repeated') || hookResult.injectMessage.includes('consecutive iterations'))) {
        this.runStats.loopDetected = true;
      }

      this.options.onIteration?.(iteration, response);
      this.throwIfCanceled(iteration + 1);

      // ──── ADD MODEL RESPONSE TO TURN ────
      const modelMessage = this.options.provider.formatResponse(response);
      modelMessage.id = this.generateId('mdl');
      this.turnMessages.push(modelMessage);

      this.lastPromptTokens = response.usage?.promptTokens ?? this.lastPromptTokens;
      if (response.usage) {
        this.runStats.tokenUsage.totalPromptTokens += response.usage.promptTokens;
        this.runStats.tokenUsage.totalCompletionTokens += response.usage.completionTokens;
        this.runStats.tokenUsage.totalTokens += response.usage.totalTokens;
        this.runStats.tokenUsage.callCount++;
      }

      // ──── EMPTY ARGS GUARD (universal, all providers) ────
      // Some models (e.g. Kimi K2.5) return tool calls with empty/null args.
      // Strip them and inject a self-correct hint so the LLM regenerates.
      if (toolCallsForExecution.length > 0) {
        const emptyArgsCalls = toolCallsForExecution.filter(tc =>
          tc.args == null
          || (typeof tc.args === 'object' && Object.keys(tc.args).length === 0)
          || tc.args === ''
        );
        if (emptyArgsCalls.length > 0) {
          const names = emptyArgsCalls.map(tc => tc.name).join(', ');
          console.warn(`[AgentRuntime] Stripping ${emptyArgsCalls.length} tool call(s) with empty args: ${names}`);
          toolCallsForExecution = toolCallsForExecution.filter(tc => !emptyArgsCalls.includes(tc));
          // Inject hint so LLM self-corrects on next iteration
          this.turnMessages.push({
            id: this.generateId('empty_hint'),
            role: 'user',
            content: `Your tool call to ${names} had empty arguments and was not executed. Please provide the required parameters (e.g. xml for create/edit) and try again.`,
          });
          if (toolCallsForExecution.length === 0) {
            iteration++;
            continue;
          }
        }
      }

      // ──── TOOL EXECUTION ────
      if (toolCallsForExecution.length > 0) {
        if (this.options.requireToolApproval) {
          this.emitRuntimeEvent({
            type: 'tool_approval_request',
            phase: 'execution',
            iteration: iteration + 1,
            toolCalls: toolCallsForExecution.map(tc => ({ id: tc.id!, name: tc.name, args: tc.args })),
          });
          const approved = await new Promise<boolean>(r => { this.pendingApproval = { resolve: r } });
          this.pendingApproval = null;
          this.throwIfCanceled(iteration + 1);
          if (!approved) {
            this.turnMessages.push({ id: this.generateId('usr'), role: 'user', content: 'Tools denied by user. Try a different approach.' });
            iteration++;
            continue;
          }
        }
        this.runStats.toolCallCount += toolCallsForExecution.length;
        const dispatchResult = await this.toolDispatcher.dispatch(toolCallsForExecution, iteration);
        const content = dispatchResult.toolResultsMessage.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part.functionResponse?.response?.success === false) {
              this.runStats.toolErrorCount++;
            }
          }
        }
        this.turnMessages.push(dispatchResult.toolResultsMessage);
        iteration++;
        continue;
      } else {
        // ──── TRUNCATION GUARD ────
        // If finishReason is present and NOT 'stop', the response was truncated
        // (e.g. 'length' = max_tokens hit, 'timeout' = stream timeout).
        // Inject a continuation hint so the LLM can resume its work.
        const fr = response.finishReason;
        if (fr && fr !== 'stop' && fr !== 'tool_calls') {
          console.warn(`[AgentRuntime] Response truncated (finishReason=${fr}). Injecting continuation.`);
          this.turnMessages.push({
            id: this.generateId('cont'),
            role: 'user',
            content: 'Your previous response was truncated. Continue where you left off.',
          });
          iteration++;
          continue;
        }

        // Turn end: summarize this turn, prepare for next
        this.emitRuntimeEvent({
          type: 'turn_end',
          phase: 'execution',
          iteration: iteration + 1,
          totalIterations: iteration + 1,
          summary: response.text || '',
        });
        this.endTurn();
        return response.text;
      }
    }

    throw new Error(`Maximum iterations (${this.maxIterations}) reached.`);
  }

  /** Returns current turn messages (for debrief/diagnostics). */
  public getMessages(): LLMMessage[] {
    return this.turnMessages;
  }

  public getRunStats() {
    return { ...this.runStats };
  }

  public getRunId(): string {
    return this.currentRunId;
  }
}
