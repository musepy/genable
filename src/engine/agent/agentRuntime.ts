/**
 * @file agentRuntime.ts
 * @description Autonomous agent runtime with a flat message journal.
 *
 * Context is a flat array of LLMMessage entries plus a static system prompt.
 * Summary (when compaction runs) lives as a synthetic user message at the head
 * of the journal. Turn boundary is inferred by walking back to the last user
 * message. Lazy compression: full messages are preserved until the budget is
 * exceeded, then the oldest pre-current-turn messages are summarized.
 */

import { LLMProvider, LLMMessage, LLMResponse, ToolCallBlock } from '../llm-client/providers/types';
import { ToolDefinition, allToolDefinitions, ToolExecutor } from './tools';
import { AgentBehaviorConfig, resolveBehavior } from './agentBehaviorConfig';
import { AgentLoopPolicy, resolveAgentLoopPolicy, ToolCallMode } from './agentLoopPolicy';
import { HookRegistry, HookRunner, createBuiltinHooksWithState } from './hooks';
import type { HookRegistration, HookContext } from './hooks';
import type { InspectionTracker } from './hooks/inspectionTracker';
import { ToolResultCleaner } from './context/toolResultCleaner';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { AgentRuntimeEvent } from '../../shared/protocol/agentRuntimeEvents';
import { LLMGenerationCoordinator } from './llmGenerationCoordinator';
import { ToolDispatcher } from './toolDispatcher';
import { TOOL_NAMES } from './tools/unified';
import { clearOverflows } from './overflowStore';
import { OutputTooLongError } from '../llm-client/providers/shared/providerErrors';
import { ContextManager } from './context/contextManager';


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
  onToolCall?: (toolCall: ToolCallBlock) => void;
  onToolResult?: (toolCall: ToolCallBlock, result: any) => void;
  onIterationStart?: (iteration: number, taskInfo?: { taskId: string; taskTitle: string }) => void;
  onIteration?: (iteration: number, response: LLMResponse, taskInfo?: { taskId: string; taskTitle: string }) => void;
  taskId?: string;
  taskTitle?: string;
  toolExecutors?: Record<string, import('./tools/types').ToolExecutor>;
  loopPolicy?: Partial<AgentLoopPolicy>;
  onRuntimeEvent?: (event: AgentRuntimeEvent) => void;
  hooks?: HookRegistration[];
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

  // ─── Layered context (delegated to ContextManager) ───
  private readonly contextManager: ContextManager;

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
  private runAbortController: AbortController | null = null;
  private currentRunId = '';
  private eventSequence = 0;
  private canceledEventEmitted = false;
  private pendingQuestion: { resolve: (answer: string) => void } | null = null;
  private chatPanelId: string | null = null;
  private turnCreatedNodes: Array<{ id: string; name?: string; type?: string }> = [];
  private inspectionTracker: InspectionTracker | null = null;
  private designRootId: string | null = null;  // persists across turns for edit-turn links
  private runStats = {
    toolCallCount: 0, toolErrorCount: 0, loopDetected: false,
    tokenUsage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, callCount: 0 },
  };

  constructor(private options: AgentRuntimeOptions) {
    this.behaviorConfig = resolveBehavior(options.behaviorConfig);
    this.loopPolicy = resolveAgentLoopPolicy(options.loopPolicy);
    this.maxIterations = options.maxIterations || this.behaviorConfig.maxIterations;
    // Context budget: 70% of context window (leave 30% for model output + safety margin)
    // chars ≈ tokens * 4 (rough estimate)
    const contextWindowTokens = options.contextWindow
      ?? options.provider.getCapabilities?.().contextWindow
      ?? 1_000_000;
    this.contextManager = new ContextManager({
      systemPrompt: options.systemPrompt || '',
      contextBudgetChars: Math.floor(contextWindowTokens * 0.7) * 4,
      provider: options.provider,
    });
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
    // All tools are first-class — tool names from definitions + TOOL_NAMES + `more` (pagination)
    this.allowedExecutionToolNames = new Set([
      ...options.tools.map((tool) => tool.name),
      ...TOOL_NAMES,
      'more',
    ]);
    // Hook system (must be initialized before ToolDispatcher so interceptors can reference hookRunner)
    this.hookRegistry = new HookRegistry();
    if (options.hooks) {
      this.hookRegistry.registerAll(options.hooks);
    } else {
      const { hooks, tracker, reset } = createBuiltinHooksWithState();
      this.hookRegistry.registerAll(hooks);
      this.inspectionTracker = tracker;
      this.resetBuiltinState = reset;
    }
    this.hookRunner = new HookRunner(this.hookRegistry, (event) => this.emitRuntimeEvent(event as RuntimeEventPayload));

    // ToolDispatcher with beforeToolExec/afterToolExec hook interceptors
    this.toolDispatcher = new ToolDispatcher(
      options.toolExecutors || {},
      options.ipcBridge,
      this.allowedExecutionToolNames,
      {
        generateId: (prefix) => this.generateId(prefix),
        normalizeToolCallId: (tc, fallbackPrefix) => this.normalizeToolCallId(tc, fallbackPrefix),
        emitRuntimeEvent: (event) => this.emitRuntimeEvent(event as RuntimeEventPayload),
        throwIfCanceled: (iteration) => this.throwIfCanceled(iteration),
        onToolCall: options.onToolCall,
        onToolResult: options.onToolResult,
        beforeToolExec: async (tc) => {
          const ctx: HookContext = {
            iteration: this.currentIteration,
            maxIterations: this.maxIterations,
            currentToolCall: tc,
            messages: this.contextManager.getCurrentTurnMessages(),
            loopPolicy: this.loopPolicy,
            generateId: (prefix) => this.generateId(prefix),
          };
          const result = await this.hookRunner.run('beforeToolExec', ctx);
          if (result.action === 'skip' || result.action === 'abort') {
            return { action: result.action, reason: result.reason, code: result.code };
          }
          return undefined;
        },
        afterToolExec: async (tc, toolResult) => {
          const ctx: HookContext = {
            iteration: this.currentIteration,
            maxIterations: this.maxIterations,
            currentToolCall: tc,
            toolResult,
            messages: this.contextManager.getCurrentTurnMessages(),
            loopPolicy: this.loopPolicy,
            generateId: (prefix) => this.generateId(prefix),
          };
          const result = await this.hookRunner.run('afterToolExec', ctx);
          if (result.modifiedResult !== undefined) {
            return { action: 'continue', modifiedResult: result.modifiedResult };
          }
          return undefined;
        },
        formatToolResults: (results) => options.provider.formatToolResults(results),
      },
    );

    // Runtime-bound tools: tools that need `this` instance state.
    // subtask is NOT registered here — it's injected externally by the caller
    // (AgentOrchestrator or parent executor) via mergeToolExecutors().
    this.registerRuntimeTools();

    if (process.env.NODE_ENV === 'test') {
      (this as any).THROTTLE_MS = 0;
    }
  }

  // ─── Cancel ──────────────────────────────────────────────────

  public cancel(reason: string = 'Canceled by user'): void {
    this.canceled = true;
    this.cancelReason = reason;
    if (this.pendingQuestion) {
      this.pendingQuestion.resolve('');
      this.pendingQuestion = null;
    }
    if (this.activeAbortController && !this.activeAbortController.signal.aborted) {
      this.activeAbortController.abort();
    }
    if (this.runAbortController && !this.runAbortController.signal.aborted) {
      this.runAbortController.abort();
    }
    this.emitCanceledEvent();
  }

  public resolveQuestion(answer: string): void {
    this.pendingQuestion?.resolve(answer);
    this.pendingQuestion = null;
  }

  public mergeToolExecutors(executors: Record<string, import('./tools/types').ToolExecutor>): void {
    this.toolDispatcher.mergeExecutors(executors);
  }

  // ─── Runtime-bound tools ────────────────────────────────────

  /**
   * Register tools that need `this` instance state (ask_user).
   * subtask is NOT here — it's injected externally via mergeToolExecutors.
   */
  private registerRuntimeTools(): void {
    if (this.allowedExecutionToolNames.has('ask_user')) {
      this.toolDispatcher.mergeExecutors({
        ask_user: async (args: any) => {
          const { question, options } = args || {};
          if (!question || !Array.isArray(options) || options.length < 2) {
            return { error: 'ask_user requires a question and 2-4 options.' };
          }
          this.emitRuntimeEvent({
            type: 'ask_user_question',
            phase: 'execution',
            iteration: this.currentIteration,
            question,
            options: options.map((o: any) => ({ label: o.label, description: o.description })),
          });
          const answer = await new Promise<string>(r => {
            this.pendingQuestion = { resolve: r };
          });
          this.pendingQuestion = null;
          this.throwIfCanceled();
          if (!answer) return { error: 'Question was canceled by user.' };
          return { data: { answer } };
        },
      });
    }
  }

  // ─── Public accessors (used by agentFactory for child config) ──

  public getCurrentIteration(): number {
    return this.currentIteration;
  }

  public getMaxIterations(): number {
    return this.maxIterations;
  }

  public getRunAbortSignal(): AbortSignal | undefined {
    return this.runAbortController?.signal;
  }

  public getActiveExecutors(): Record<string, ToolExecutor> {
    return this.toolDispatcher.getExecutors();
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
      const failSuffix = tr?.error ? ` — ${tr.error}` : '';
      console.log(`[RuntimeEvent] tool_result: ${tr?.name} ${!tr?.error ? 'ok' : 'FAIL'} (${tr?.durationMs}ms)${failSuffix}`);
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

  private normalizeToolCallId(tc: ToolCallBlock, fallbackPrefix = 'tool'): string {
    if (typeof tc.id === 'string' && tc.id.trim().length > 0) return tc.id;
    return this.generateId(fallbackPrefix);
  }

  private generateId(prefix: string): string {
    this.idCounter++;
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 5);
    return `${prefix}_${timestamp}${random}${this.idCounter}`;
  }

  // ── Chat Panel System ─────────────────────────────────────────────
  // Persistent chat container: all messages (user + agent) render into
  // a single panel. Created on first use, reused across turns.

  /**
   * Chat panel rendering is disabled — render tool was removed.
   * Returns null immediately; callers fall back gracefully.
   */
  private async ensureChatPanel(_iteration: number): Promise<string | null> {
    return null;
  }

  /**
   * Render user's prompt as a message in the chat panel.
   */
  private async renderUserMessage(prompt: string, iteration: number): Promise<void> {
    const panelId = await this.ensureChatPanel(iteration);
    if (!panelId) return;

    let text = prompt.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (text.length > 200) text = text.slice(0, 200) + '…';

    const markup = `user-bubble\n  user-name: You\n  user-text: ${text}`;
    await this.toolDispatcher.dispatch(
      [{ type: 'tool_call' as const, id: this.generateId('user-msg'), name: 'render', input: { markup, parentId: panelId } }],
      iteration,
    );
  }

  /**
   * Render agent's text response in the chat panel with optional design links.
   * Non-fatal: failures are logged, never block the turn.
   */
  private async renderAgentBubble(text: string, iteration: number): Promise<void> {
    const panelId = await this.ensureChatPanel(iteration);
    if (!panelId) return;

    // Strip markdown formatting for clean display
    let clean = text
      .replace(/\*\*([^*]+)\*\*/g, '$1')   // **bold** → bold
      .replace(/\*([^*]+)\*/g, '$1')        // *italic* → italic
      .replace(/~~([^~]+)~~/g, '$1')        // ~~strike~~ → strike
      .replace(/^[-*]\s+/gm, '• ')          // - item → • item
      .replace(/\n{2,}/g, '\n');            // collapse blank lines

    // Truncate to max 300 chars
    if (clean.length > 300) clean = clean.slice(0, 300) + '…';

    // Flatten to single line (render markup is line-based, newlines would break parsing)
    clean = clean.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();

    const markupLines = [
      'bubble',
      '  agent-name: Genable',
      `  agent-text: ${clean}`,
    ];

    // Update persistent design root from this turn's creations
    if (this.turnCreatedNodes.length > 0) {
      this.designRootId = this.turnCreatedNodes[0]?.id;
    }
    // Add hyperlink: current turn's root, or fallback to previous turn's design
    const linkNodeId = this.turnCreatedNodes.length > 0
      ? this.turnCreatedNodes[0]?.id
      : this.designRootId;
    if (linkNodeId) {
      markupLines.push(`  link-text [link:NODE:${linkNodeId}]: → View design`);
    }

    const markup = markupLines.join('\n');
    await this.toolDispatcher.dispatch(
      [{ type: 'tool_call' as const, id: this.generateId('bubble'), name: 'render', input: { markup, parentId: panelId } }],
      iteration,
    );
  }

  /**
   * Extract the root design node ID from tool result data.
   * For chains, picks the shallowest path (fewest `/` segments) — the design root.
   */
  /**
   * Collect created node info from RAW tool result data (before presentForLLM).
   * Reads from result.data — the original format, not the flattened presentation.
   */
  private collectCreatedNodes(rawResult: any): void {
    const data = rawResult?.data;
    if (!data || rawResult?.error) return;

    // jsx tool: { data: { id: "1:2", name: "Card", type: "frame", createdIds: ["1:2","1:3",...] } }
    if (data.id && typeof data.id === 'string') {
      this.turnCreatedNodes.push({
        id: data.id,
        name: data.name,
        type: data.type,
      });
      // jsx-created nodes are born clean — no inspect needed before first mutation
      // Mark ALL created nodes (root + all descendants), not just root
      if (Array.isArray(data.createdIds)) {
        for (const id of data.createdIds) {
          this.inspectionTracker?.markInspected(id);
        }
      } else {
        this.inspectionTracker?.markInspected(data.id);
      }
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
    this.runAbortController = new AbortController();
    this.canceled = false;
    this.cancelReason = 'Canceled by user';

    // Append user message — this starts the new turn (turn boundary is
    // inferred by walking back to the last user message).
    this.contextManager.addMessage({
      id: this.generateId('usr'),
      role: 'user',
      content: userPrompt,
    });

    let iteration = 0;
    let askUserNudged = false;
    this.resetBuiltinState?.();
    this.llmCoordinator.reset();
    this.toolDispatcher.resetCallTracking();
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

    // ── Token scan: Onboarding ──
    if (this.contextManager.isFirstTurn() && this.options.ipcBridge) {
      try {
        const scanResult = await Promise.race([
          this.options.ipcBridge.callTool('scan-tokens', {}),
          new Promise<null>(r => setTimeout(() => r(null), 3000)),
        ]);
        if (scanResult && !scanResult.error && scanResult.data) {
          const { snapshot, summary, tokenCount } = scanResult.data;
          if (tokenCount > 0) {
            this.contextManager.insertBeforeCurrentTurn({
              id: this.generateId('tok'),
              role: 'user',
              content: `[System: Design tokens detected — ${summary}]`,
            });
          }
        }
      } catch (e) {
        console.warn('[TokenScan] Failed to scan design tokens (non-fatal):', e);
      }
    }

    // ── Render user message in chat panel ──
    this.turnCreatedNodes = [];
    try {
      await Promise.race([
        this.renderUserMessage(userPrompt, 0),
        new Promise(r => setTimeout(r, 5000)),
      ]);
    } catch (e: any) {
      console.warn('[ChatPanel] User message render failed (non-fatal):', e?.message);
    }

    // ════════════════════════════════════════════
    // ITERATION LOOP
    // ════════════════════════════════════════════
    while (iteration < this.maxIterations) {
      this.throwIfCanceled(iteration + 1);
      this.currentIteration = iteration;

      // ──── INTRA-TURN COMPRESSION ────
      // After the LLM has consumed a tool result, compress it to a compact summary.
      // Preserves node IDs and error details; drops verbose content.
      if (iteration > 0) {
        const compressed = this.contextManager.compressConsumedResults();
        if (compressed > 0) {
          console.log(`[Context] Compressed ${compressed} consumed tool result(s) in current turn`);
        }
      }

      // ──── HOOK: beforeIteration ────
      const beforeIterCtx: HookContext = {
        iteration,
        maxIterations: this.maxIterations,
        messages: this.contextManager.getCurrentTurnMessages(),
        loopPolicy: this.loopPolicy,
        generateId: (prefix) => this.generateId(prefix),
      };
      const beforeIterResult = await this.hookRunner.run('beforeIteration', beforeIterCtx);
      if (beforeIterResult.action === 'abort') {
        throw new Error(beforeIterResult.reason || 'Aborted by beforeIteration hook');
      }

      const { system, messages: prompt } = this.contextManager.assemblePrompt();
      const currentTokens = this.contextManager.getLastPromptTokens();

      // Debug: dump full LLM prompt for each iteration (visible in Figma DevTools Console)
      console.log(`\n${'='.repeat(60)}\n[Iteration ${iteration + 1}/${this.maxIterations}] LLM Prompt (${prompt.length} messages, system: ${system.length} chars)\n${'='.repeat(60)}`);
      console.log(`  [system] ${system.slice(0, 500)}`);
      for (const m of prompt) {
        const contentPreview = typeof m.content === 'string'
          ? m.content.slice(0, 500)
          : Array.isArray(m.content)
            ? (m.content as any[]).map((p: any) => {
                if (p.type === 'text') return `[text] ${p.text.slice(0, 200)}`;
                if (p.type === 'tool_call') return `[call] ${p.name}(${JSON.stringify(p.input).slice(0, 200)})`;
                if (p.type === 'tool_result') return `[result] ${p.name}: ${JSON.stringify(p.data).slice(0, 200)}`;
                if (p.type === 'thinking') return `[thinking] ${p.text.slice(0, 100)}`;
                return '[other]';
              }).join('\n    ')
            : '(empty)';
        console.log(`  [${m.role}] ${m.id}: ${contentPreview}`);
      }
      console.log('='.repeat(60));

      // Use API-reported tokens when available; fall back to chars/4 estimation
      const effectiveTokens = currentTokens > 0
        ? currentTokens
        : Math.ceil(this.contextManager.estimateContextChars() / 4);

      this.emitRuntimeEvent({
        type: 'context_usage',
        iteration: iteration + 1,
        phase: 'execution',
        usage: {
          current: effectiveTokens,
          max: AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_CONTEXT_TOKENS,
          percent: Math.round((effectiveTokens / AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_CONTEXT_TOKENS) * 100),
          visibleMessages: prompt.length,
          hiddenMessages: 0,
          layers: this.contextManager.getLayerBreakdown(iteration === 0),
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

      let toolCallsForExecution: ToolCallBlock[] = [];
      let rawToolCallsForLoopDetection: ToolCallBlock[] = [];
      let response: LLMResponse;

      try {
        this.llmCoordinator.config.notifyIterationStart = notifyIterationStartOnce;
        const genResult = await this.llmCoordinator.generate(
          {
            messages: prompt,
            system,
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
      // All tools are first-class now — no unwrapping needed
      const rawCalls = rawToolCallsForLoopDetection.length > 0 ? rawToolCallsForLoopDetection : toolCallsForExecution;
      const hookCtx: HookContext = {
        iteration,
        maxIterations: this.maxIterations,
        responseText: response.text,
        toolCalls: rawCalls,
        messages: this.contextManager.getCurrentTurnMessages(),
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
      this.contextManager.addMessage(modelMessage);

      // Token tracking: use API usage when available, fall back to chars/4 estimation.
      // Critical for providers like DashScope/Kimi K2.5 whose streaming doesn't return usage.
      if (response.usage && response.usage.promptTokens > 0) {
        this.contextManager.setLastPromptTokens(response.usage.promptTokens);
        this.runStats.tokenUsage.totalPromptTokens += response.usage.promptTokens;
        this.runStats.tokenUsage.totalCompletionTokens += response.usage.completionTokens;
        this.runStats.tokenUsage.totalTokens += response.usage.totalTokens;
        this.runStats.tokenUsage.callCount++;
      } else {
        // Fallback: estimate from assembled context chars (chars / 4 ≈ tokens)
        const estimatedPromptTokens = Math.ceil(this.contextManager.estimateContextChars() / 4);
        this.contextManager.setLastPromptTokens(estimatedPromptTokens);
        this.runStats.tokenUsage.totalPromptTokens += estimatedPromptTokens;
        this.runStats.tokenUsage.totalCompletionTokens += (response.usage?.completionTokens || 0);
        this.runStats.tokenUsage.totalTokens += estimatedPromptTokens + (response.usage?.completionTokens || 0);
        this.runStats.tokenUsage.callCount++;
      }

      // ──── REAL TRUNCATION FAIL-FAST ────
      // The model genuinely hit max_tokens (finishReason='length'). If there
      // are no usable tool calls, the partial text is the only output and it
      // was cut off mid-thought. Surface this as an actionable user error.
      // (If tool calls survived sanitization, they're complete — let them through.)
      if (response.finishReason === 'length' && toolCallsForExecution.length === 0) {
        throw new OutputTooLongError(
          this.options.provider.name,
          this.loopPolicy.maxOutputTokens,
          response.text || '',
        );
      }

      // ──── TOOL EXECUTION ────
      // Empty-args filtering is handled by builtin hooks:
      //   emptyArgsCounter (afterLLMResponse) → counts/aborts/injects hint
      //   emptyArgsSkip (beforeToolExec) → skips individual empty-args calls
      if (toolCallsForExecution.length > 0) {
        this.runStats.toolCallCount += toolCallsForExecution.length;
        const dispatchResult = await this.toolDispatcher.dispatch(toolCallsForExecution, iteration);

        // State tracking from RAW results (decoupled from presentForLLM).
        // Cap rejects (code === 'CAP_REJECT') are runtime-synthesized retry
        // instructions — not genuine tool failures — so they are excluded
        // from the error count.
        for (const raw of dispatchResult.rawResults) {
          if (raw.error && raw.code !== 'CAP_REJECT') this.runStats.toolErrorCount++;
          this.collectCreatedNodes(raw.result);
        }

        // LLM context from PRESENTED results (separate concern)
        this.contextManager.addMessage(dispatchResult.toolResultsMessage);

        // Guardrails (consecutiveFailure, partialFailure, budget) are now
        // handled by builtin afterIteration hooks.

        // ──── HOOK: afterIteration ────
        // Use raw results for hooks (not presented format)
        const iterationToolResults: Array<{ toolCall: ToolCallBlock; result: any }> = [];
        for (let i = 0; i < toolCallsForExecution.length && i < dispatchResult.rawResults.length; i++) {
          iterationToolResults.push({
            toolCall: toolCallsForExecution[i],
            result: dispatchResult.rawResults[i].result,
          });
        }
        const afterIterCtx: HookContext = {
          iteration,
          maxIterations: this.maxIterations,
          messages: this.contextManager.getCurrentTurnMessages(),
          loopPolicy: this.loopPolicy,
          generateId: (prefix) => this.generateId(prefix),
          iterationToolResults,
        };
        const afterIterResult = await this.hookRunner.run('afterIteration', afterIterCtx);
        if (afterIterResult.action === 'abort') {
          throw new Error(afterIterResult.reason || 'Aborted by afterIteration hook');
        }

        iteration++;
        continue;
      } else {
        // ──── EMPTY RESPONSE DETECTION ────
        // LLM returned no text and no tool calls (after coordinator retries).
        // Mark turn_end so the UI can surface a retry hint.
        const isEmptyResponse = !response.text || response.text.trim().length === 0;
        if (isEmptyResponse) {
          console.warn(`[AgentRuntime] Empty response from LLM at iteration ${iteration + 1}`);
        }

        // ──── ASK_USER NUDGE ────
        // If text-only response contains multiple question marks, the LLM is trying
        // to ask questions via plain text instead of using ask_user. Nudge once per run.
        if (!askUserNudged && response.text && response.text.includes('?') && !response.text.includes('✓')) {
          const questionCount = (response.text.match(/\?/g) || []).length;
          if (questionCount >= 2) {
            askUserNudged = true;
            console.log(`[AgentRuntime] Text-only response with ${questionCount} questions — nudging to use ask_user tool`);
            this.contextManager.addMessage({
              id: this.generateId('model'),
              role: 'model',
              content: response.text,
            });
            this.contextManager.addMessage({
              id: this.generateId('nudge'),
              role: 'user',
              content: 'Do not ask questions in plain text — the user cannot reply inline. Use the ask_user tool to present options. Pick the single most important question and call ask_user with 2-4 options.',
            });
            iteration++;
            continue;
          }
        }

        // Auto-bubble: render agent's reply in chat panel BEFORE turn_end
        // (so dev bridge nodeTree snapshot captures it)
        if (response.text) {
          try {
            await Promise.race([
              this.renderAgentBubble(response.text, iteration),
              new Promise(r => setTimeout(r, 5000)),
            ]);
          } catch (e: any) {
            console.warn('[AutoBubble] Failed (non-fatal):', e?.message);
          }
        }

        // Turn end: summarize this turn, prepare for next
        this.emitRuntimeEvent({
          type: 'turn_end',
          phase: 'execution',
          iteration: iteration + 1,
          totalIterations: iteration + 1,
          summary: response.text || '',
          ...(isEmptyResponse ? { emptyResponse: true } : {}),
        });
        await this.contextManager.endTurn();
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
    await this.contextManager.endTurn();
    return `I've used all ${this.maxIterations} iterations. My progress is saved — say "continue" to pick up where I left off.`;
  }

  /** Returns current turn messages (for debrief/diagnostics). */
  public getMessages(): LLMMessage[] {
    return this.contextManager.getCurrentTurnMessages();
  }

  /** Structured node info created during the current turn. */
  public getTurnCreatedNodes(): Array<{ id: string; name?: string; type?: string }> {
    return [...this.turnCreatedNodes];
  }

  /** Backward compat: flat ID list. */
  public getTurnCreatedNodeIds(): string[] {
    return this.turnCreatedNodes.map(n => n.id);
  }

  public getRunStats() {
    return { ...this.runStats };
  }

  public getRunId(): string {
    return this.currentRunId;
  }
}
