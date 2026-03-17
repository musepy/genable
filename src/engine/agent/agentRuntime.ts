/**
 * @file agentRuntime.ts
 * @description Autonomous agent runtime with layered context management.
 *
 * Context is structured in 4 layers, not a flat message array:
 *   1. systemPrompt          — static, set once at construction
 *   2. summary               — compressed history (only populated when context is near-full)
 *   3. conversationHistory   — previous turns' FULL messages (kept as long as context allows)
 *   4. turnMessages          — current turn's messages, moved to history at turn end
 *
 * Lazy compression: full messages are preserved across turns. Only when the total
 * context approaches the model's context window are the oldest turns compressed
 * into the summary. This matches how Claude Code works — use the context you have,
 * only compress when you must.
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMToolCall } from '../llm-client/providers/types';
import { ToolDefinition, ToolParameter, allToolDefinitions } from './tools';
import { AgentBehaviorConfig, resolveBehavior } from './agentBehaviorConfig';
import { AgentLoopPolicy, resolveAgentLoopPolicy, ToolCallMode } from './agentLoopPolicy';
import { HookRegistry, HookRunner, createBuiltinHooksWithState } from './hooks';
import type { HookRegistration, HookContext } from './hooks';
import { ToolResultCleaner } from './context/toolResultCleaner';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { buildCompressionSummary, capSummary } from './context/contextSummarizer';
import { AgentRuntimeEvent } from '../../shared/protocol/agentRuntimeEvents';
import { LLMGenerationCoordinator } from './llmGenerationCoordinator';
import { ToolDispatcher } from './toolDispatcher';
import { COMMAND_NAMES } from './tools/unified/commandRegistry';
import { getContextProfile } from './context/constants';
import { clearOverflows } from './overflowStore';
import { executeSubtask } from './subtask/executor';
import type { SubtaskContext } from './subtask/types';

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
  /** Model's context window in tokens. Used for lazy compression budget. */
  contextWindow?: number;
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
  private summary: string = '';                    // compressed history (only when context is near-full)
  private conversationHistory: LLMMessage[] = [];  // previous turns' FULL messages
  private turnMessages: LLMMessage[] = [];         // current turn only, moved to history at turn end
  private readonly contextBudgetChars: number;     // max chars before triggering compression

  private lastPromptTokens: number = 0;
  private cleaner: ToolResultCleaner;
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
  private currentIteration = 0;
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
    // Context budget: 70% of context window (leave 30% for model output + safety margin)
    // chars ≈ tokens * 4 (rough estimate)
    const contextWindowTokens = options.contextWindow
      ?? options.provider.getCapabilities?.().contextWindow
      ?? 1_000_000;
    this.contextBudgetChars = Math.floor(contextWindowTokens * 0.7) * 4;
    // ToolResultCleaner uses command definitions (not the `run` wrapper)
    // so it can route to the correct cleaning strategy per command.
    this.cleaner = new ToolResultCleaner(allToolDefinitions);
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
    // Allow both the `run` wrapper AND all command names (unwrapped by dispatcher)
    this.allowedExecutionToolNames = new Set([
      ...options.tools.map((tool) => tool.name),
      ...COMMAND_NAMES,
    ]);
    this.toolDispatcher = new ToolDispatcher(
      options.toolExecutors || {},
      options.ipcBridge,
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

    // Register subtask executor (bounded self-recursion)
    this.toolDispatcher.mergeExecutors({
      subtask: async (args: any) => {
        const childContext: SubtaskContext = {
          provider: this.options.provider,
          ipcBridge: this.options.ipcBridge,
          systemPrompt: this.staticSystemPrompt,
          tools: this.options.tools,
          toolExecutors: this.options.toolExecutors,
          maxIterations: Math.min(Math.floor((this.maxIterations - this.currentIteration) / 2), 20),
          depth: 0,
          maxDepth: 2,
          isParentCanceled: () => this.canceled,
          onRuntimeEvent: this.options.onRuntimeEvent,
        };
        return executeSubtask(args?.prompt || args?.input || '', childContext);
      },
    });

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
   * Assemble the prompt from 4-layer context.
   * Layers: system → summary (compressed) → conversation history (full) → current turn.
   */
  private assemblePrompt(): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // Layer 1: static system prompt
    if (this.staticSystemPrompt) {
      messages.push({ id: 'sys_static', role: 'system', content: this.staticSystemPrompt });
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
   * turnMessages are NOT cleared here — they stay available for getMessages()
   * (used by debrief). They're cleared at the start of the next run().
   */
  private endTurn(): void {
    // Move current turn's full messages to conversation history
    this.conversationHistory.push(...this.turnMessages);

    // Lazy compression: only compress when approaching context budget
    this.compressIfNeeded();
  }

  // ─── Lazy compression ──────────────────────────────────────

  /**
   * Estimate total context size in chars (across all 4 layers).
   */
  private estimateContextChars(): number {
    let total = this.staticSystemPrompt.length + this.summary.length;
    for (const msg of this.conversationHistory) {
      total += this.estimateMessageChars(msg);
    }
    for (const msg of this.turnMessages) {
      total += this.estimateMessageChars(msg);
    }
    return total;
  }

  private estimateMessageChars(msg: LLMMessage): number {
    if (typeof msg.content === 'string') return msg.content.length;
    if (!Array.isArray(msg.content)) return 0;
    let total = 0;
    for (const part of msg.content) {
      if (part.text) total += part.text.length;
      if (part.functionCall) {
        total += (part.functionCall.name?.length || 0)
          + JSON.stringify(part.functionCall.args || {}).length;
      }
      if (part.functionResponse) {
        total += (part.functionResponse.name?.length || 0)
          + JSON.stringify(part.functionResponse.response || {}).length;
      }
      // Skip inlineData — image token count is provider-specific
    }
    return total;
  }

  /**
   * Compress oldest turns from conversationHistory into summary,
   * but ONLY if total context exceeds the budget.
   *
   * Compresses one turn at a time (user msg + subsequent model/tool msgs)
   * until we're under budget or history is empty.
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
      // Extract the oldest turn (from first user msg to next user msg)
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
   * Returns the extracted messages (removed from conversationHistory).
   */
  private extractOldestTurn(): LLMMessage[] {
    if (this.conversationHistory.length === 0) return [];

    // Find the end of the first turn (next user message after index 0)
    let endIdx = this.conversationHistory.length;
    for (let i = 1; i < this.conversationHistory.length; i++) {
      if (this.conversationHistory[i].role === 'user') {
        endIdx = i;
        break;
      }
    }

    return this.conversationHistory.splice(0, endIdx);
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

    // Clear previous turn's messages (already moved to conversationHistory by endTurn)
    this.turnMessages = [];

    // Add user message to current turn
    this.turnMessages.push({
      id: this.generateId('usr'),
      role: 'user',
      content: userPrompt,
    });

    let iteration = 0;
    let emptyArgsCount = 0;
    let truncationCount = 0;
    let consecutiveFailIterations = 0;
    this.resetBuiltinState?.();
    this.llmCoordinator.reset();
    clearOverflows();
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
      this.currentIteration = iteration;

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
      // Unwrap `run` tool calls so loop detection sees command names (not all 'run')
      const rawCalls = rawToolCallsForLoopDetection.length > 0 ? rawToolCallsForLoopDetection : toolCallsForExecution;
      const unwrappedCalls = rawCalls.map(tc => ToolDispatcher.unwrapRunCommand(tc));
      const hookCtx: HookContext = {
        iteration,
        maxIterations: this.maxIterations,
        responseText: response.text,
        toolCalls: unwrappedCalls,
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
      // Bounded: max 3 consecutive empty-args iterations before abort.
      if (toolCallsForExecution.length > 0) {
        const emptyArgsCalls = toolCallsForExecution.filter(tc =>
          tc.args == null
          || (typeof tc.args === 'object' && Object.keys(tc.args).length === 0)
          || tc.args === ''
        );
        if (emptyArgsCalls.length > 0) {
          emptyArgsCount++;
          if (emptyArgsCount > 3) {
            throw new Error('Model repeatedly returns empty tool arguments (3+ times). Aborting.');
          }
          const names = emptyArgsCalls.map(tc => tc.name).join(', ');
          console.warn(`[AgentRuntime] Stripping ${emptyArgsCalls.length} tool call(s) with empty args: ${names} (${emptyArgsCount}/3)`);
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
        } else {
          emptyArgsCount = 0; // Reset on valid args
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

        // ──── GUARDRAIL: MANDATORY REPAIR + CONSECUTIVE FAILURE TRACKING ────
        if (Array.isArray(content)) {
          // Check if ALL tool calls in this iteration failed
          const allFailed = content.every((part: any) =>
            part.functionResponse?.response?.success === false
          );

          if (allFailed) {
            consecutiveFailIterations++;
          } else {
            consecutiveFailIterations = 0;
          }

          // P2: PARTIAL_FAILURE → inject mandatory repair instruction
          const partialFailures = content
            .filter((part: any) => part.functionResponse?.response?.error?.code === 'PARTIAL_FAILURE')
            .map((part: any) => part.functionResponse.response);

          if (partialFailures.length > 0) {
            const errorSummaries: string[] = [];
            for (const pf of partialFailures) {
              const errors = pf.data?.errors;
              if (Array.isArray(errors)) {
                for (const e of errors.slice(0, 5)) {
                  errorSummaries.push(`- ${e.op}: ${e.error}`);
                }
              }
            }
            if (errorSummaries.length > 0) {
              this.turnMessages.push({
                id: this.generateId('repair'),
                role: 'user',
                content: `⚠ PARTIAL_FAILURE detected. Before proceeding, you MUST fix these errors:\n${errorSummaries.join('\n')}\nUse the idMap from successful nodes to reference them. Do NOT create new content until these are resolved.`,
              });
            }
          }

          // Consecutive failure escalation: after N consecutive all-fail iterations,
          // inject a strategy-change directive
          if (consecutiveFailIterations >= AGENT_RUNTIME_CONSTANTS.CONSECUTIVE_FAILURE_THRESHOLD) {
            this.turnMessages.push({
              id: this.generateId('strategy'),
              role: 'user',
              content: `⚠ ${consecutiveFailIterations} consecutive iterations have ALL failed. Your current approach is not working. `
                + `STOP and change strategy: use context/outline to re-examine the canvas state, `
                + `verify node IDs exist, or explain the blocker to the user.`,
            });
          }
        }

        // Note: no iteration budget injection. The agent stops naturally via
        // text-only response. Safety net is maxIterations=200 (ceiling, not target).

        iteration++;

        // ── BUDGET WARNING ──
        const remaining = this.maxIterations - iteration; // iteration was just incremented
        const threshold = Math.ceil(this.maxIterations * 0.2);
        if (remaining === threshold && remaining > 0) {
          this.turnMessages.push({
            id: this.generateId('budget'),
            role: 'user',
            content: `[Budget] ${remaining} iterations remaining out of ${this.maxIterations}. Wrap up your current work — summarize progress and tell the user what's left if you can't finish.`,
          });
        }

        continue;
      } else {
        // ──── TRUNCATION GUARD ────
        // If finishReason is present and NOT 'stop', the response was truncated.
        // Bounded: max 3 continuations before forcing turn end.
        const fr = response.finishReason;
        if (fr && fr !== 'stop' && fr !== 'tool_calls') {
          truncationCount++;
          if (truncationCount <= 3) {
            console.warn(`[AgentRuntime] Response truncated (finishReason=${fr}, ${truncationCount}/3). Injecting continuation.`);
            this.turnMessages.push({
              id: this.generateId('cont'),
              role: 'user',
              content: 'Your previous response was truncated. Continue where you left off.',
            });
            iteration++;
            continue;
          }
          console.warn(`[AgentRuntime] Truncation limit reached (3). Forcing turn end.`);
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

    // Graceful budget exhaustion: endTurn + return instead of throw
    this.emitRuntimeEvent({
      type: 'budget_exhausted',
      phase: 'execution',
      iteration,
      maxIterations: this.maxIterations,
    });
    this.endTurn();
    return `I've used all ${this.maxIterations} iterations. My progress is saved — say "continue" to pick up where I left off.`;
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
