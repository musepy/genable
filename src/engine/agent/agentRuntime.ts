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
import { ToolDefinition, ToolExecutor } from './tools';
import { AgentBehaviorConfig, resolveBehavior } from './agentBehaviorConfig';
import { AgentLoopPolicy, resolveAgentLoopPolicy, ToolCallMode } from './agentLoopPolicy';
import { HookRegistry, HookRunner, createBuiltinHooksWithState } from './hooks';
import type { HookRegistration, HookContext } from './hooks';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { AgentRuntimeEvent } from '../../shared/protocol/agentRuntimeEvents';
import { LLMGenerationCoordinator } from './llmGenerationCoordinator';
import { ToolDispatcher } from './toolDispatcher';
import { TOOL_NAMES } from './tools/unified';
import { clearOverflows } from './overflowStore';
import { OutputTooLongError } from '../llm-client/providers/shared/providerErrors';
import { ContextManager } from './context/contextManager';
import { renderKnowledgeMenu } from '../llm-client/context/knowledgeLibrarySection';
import { RyowStore, VARIABLE_RELATED_TOOLS } from './ryowStore';
import { setVariableResolutionMode } from '../actions/handlers/modeCoverageCheck';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Per-tool likely-false-positive count that triggers a single
 * `rollback_signal` event for the session. Spec §5.4 / §7.2 — purely
 * observational, not used to auto-flip `variableResolution`.
 */
const ROLLBACK_SIGNAL_THRESHOLD = 3;

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
  private pendingQuestion: { resolve: (response: import('../../shared/protocol/agentRuntimeEvents').AskUserResponse) => void } | null = null;
  private chatPanelId: string | null = null;
  private turnCreatedNodes: Array<{ id: string; name?: string; type?: string }> = [];
  private turnCreatedIds: string[] = [];
  /**
   * Per-turn read-your-own-writes store (variable + collection state). See
   * docs/knowledge/variable-resolver-design-2026-05.md §3.3. Cleared at the
   * start of every `run()` — subtask child runtimes start with their own
   * empty store (no parent inheritance) per spec §8 #4.
   */
  private ryowStore: RyowStore = new RyowStore();
  private designRootId: string | null = null;  // persists across turns for edit-turn links
  /** Monotonically increasing turn counter, paired with turn_start/turn_end events for external tooling. */
  private turnCounter = 0;
  /** Wall-clock ms when the current run() started — used to compute durationMs in abort events. */
  private runStartMs = 0;
  private runStats = {
    toolCallCount: 0, toolErrorCount: 0, loopDetected: false,
    tokenUsage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, callCount: 0 },
  };
  /**
   * Phase 2 step 7: per-session MISSING_MODE_VALUES failure tracking.
   * Spec §5.4 — each entry records a binding rejection so the rollback
   * detector can decide if any of them are regressions (variable's RYOW
   * mode coverage matches the failure's missing modes ⇒ legitimate
   * protection; mismatch ⇒ likely resolver bug).
   *
   * For Phase 1 of step 7 (this commit), we just track. The auto-revert
   * decision logic lives in Phase 3 of the rollout.
   */
  private missingModeValuesFailures: Array<{
    tool_name: string;
    node_id: string;
    variable_id: string;
    missing_modes: string[];
    iteration: number;
    /** True when RyowStore says the variable lacks the modes ⇒ legitimate protection. */
    likely_legitimate: boolean;
    ts: number;
  }> = [];
  /**
   * Per-tool likely-false-positive counter. When count >= ROLLBACK_SIGNAL_THRESHOLD
   * we emit a single `rollback_signal` event so dashboards can surface the
   * regression. We DO NOT auto-flip `variableResolution` — Phase 3 of the
   * rollout owns auto-rollback. Spec §5.4 / §7.2.
   */
  private modeCoverageFailureCounters = new Map<string, { legit: number; false_positive: number }>();
  /** Tools that already emitted rollback_signal this session — emit-once-per-tool. */
  private rollbackSignalEmittedFor = new Set<string>();

  constructor(private options: AgentRuntimeOptions) {
    this.behaviorConfig = resolveBehavior(options.behaviorConfig);
    this.loopPolicy = resolveAgentLoopPolicy(options.loopPolicy);
    this.maxIterations = options.maxIterations || this.behaviorConfig.maxIterations;
    // Sync the main-thread mode-coverage checker to the active resolver
    // phase. Tests + local executors share this realm, so the setter takes
    // effect immediately. Cross-thread (IPC) sync still happens per-call via
    // `getRuntimeContext` below (toolCallHandler.ts).
    setVariableResolutionMode(this.behaviorConfig.variableResolution);
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
    this.llmCoordinator = new LLMGenerationCoordinator(
      options.provider,
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
      const { hooks, reset } = createBuiltinHooksWithState();
      this.hookRegistry.registerAll(hooks);
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
        // Phase 2 step 4 + 7: thread variableResolution from agent config
        // to main-thread handlers via IPC context so the mode-coverage
        // check honors the runtime escape valve.
        getRuntimeContext: () => ({
          variableResolution: this.behaviorConfig.variableResolution,
        }),
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

          // Pick the result the hook chose (or the original) so the rest of
          // the post-processing (RYOW recording + injection) operates on the
          // value that will actually be returned to the LLM.
          let activeResult = result.modifiedResult !== undefined
            ? result.modifiedResult
            : toolResult;
          activeResult = this.processVariableToolResult(tc, activeResult);

          if (activeResult !== toolResult) {
            return { action: 'continue', modifiedResult: activeResult };
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
      this.pendingQuestion.resolve({});
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

  public resolveQuestion(response: import('../../shared/protocol/agentRuntimeEvents').AskUserResponse | string): void {
    if (!this.pendingQuestion) return;
    // String input is treated as freeText (back-compat with old callers).
    const normalized = typeof response === 'string' ? { freeText: response } : response;
    this.pendingQuestion.resolve(normalized);
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
          const { questions } = args || {};
          if (!Array.isArray(questions) || questions.length < 1 || questions.length > 4) {
            return { error: 'ask_user requires "questions" — an array of 1-4 entries.' };
          }
          for (const q of questions) {
            if (!q || typeof q.question !== 'string' || !q.question.trim()) {
              return { error: 'each question requires a non-empty "question" string.' };
            }
            if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
              return { error: `question "${q.question}" requires 2-4 "options".` };
            }
          }
          const normalized = questions.map((q: any) => ({
            question: String(q.question),
            header: q.header ? String(q.header) : undefined,
            options: q.options.map((o: any) => ({ label: String(o.label), description: o.description ? String(o.description) : undefined })),
            multiSelect: !!q.multiSelect,
          }));
          this.emitRuntimeEvent({
            type: 'ask_user_question',
            phase: 'execution',
            iteration: this.currentIteration,
            questions: normalized,
          });
          const response = await new Promise<import('../../shared/protocol/agentRuntimeEvents').AskUserResponse>(r => {
            this.pendingQuestion = { resolve: r };
          });
          this.pendingQuestion = null;
          this.throwIfCanceled();
          const hasAnswers = Array.isArray(response.answers) && response.answers.length > 0;
          const hasFreeText = typeof response.freeText === 'string' && response.freeText.trim().length > 0;
          if (!hasAnswers && !hasFreeText) return { error: 'Question was canceled by user.' };
          return { data: response };
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

    // jsx tool shape: { data: { id, name, type, createdIds: [root + descendants] } }
    if (data.id && typeof data.id === 'string') {
      this.turnCreatedNodes.push({
        id: data.id,
        name: data.name,
        type: data.type,
      });
    }

    // subtask tool shape: { data: { createdNodes: [{id, name, type}], createdIds: [...], summary } }
    // Propagate child's root nodes so parent's designRootId / link-text work.
    if (Array.isArray(data.createdNodes)) {
      for (const node of data.createdNodes) {
        if (node?.id && typeof node.id === 'string') {
          this.turnCreatedNodes.push({ id: node.id, name: node.name, type: node.type });
        }
      }
    }

    // Collect created node IDs for designRootId resolution and link-text rendering.
    // For subtask, child runtime already processed descendants internally — parent
    // trusts the returned createdIds in lieu of re-inspecting.
    // Tracker writes are handled centrally by trackerFeedHook (afterToolExec p4).
    if (Array.isArray(data.createdIds)) {
      for (const id of data.createdIds) {
        if (typeof id === 'string') {
          this.turnCreatedIds.push(id);
        }
      }
    } else if (data.id && typeof data.id === 'string') {
      this.turnCreatedIds.push(data.id);
    }
  }

  /**
   * Post-process a tool result for variable-related side effects:
   *  1. Record collection / variable creations into RyowStore.
   *  2. Inject `_ryow` snapshot when the tool is variable-related.
   *  3. Enrich AMBIGUOUS_NAME_AUTOPICK warnings with `source` /
   *     `suggested_id` from RyowStore (handler can't see RyowStore — it
   *     lives in the main thread; this is the sandbox-side enrichment).
   *  4. Emit `ambiguous_autopick` runtime events for any such warning.
   *
   * Spec: docs/knowledge/variable-resolver-design-2026-05.md §3.3, §5.1.
   */
  private processVariableToolResult(tc: ToolCallBlock, result: any): any {
    if (!result || typeof result !== 'object') return result;

    const toolName = tc.name;

    // ── 1. Record creations ──
    if (!result.error && result.data) {
      const data = result.data;
      // ensure_collection / create_collection
      if (toolName === 'ensure_collection' || toolName === 'create_collection') {
        const id: string | undefined = typeof data.collection_id === 'string'
          ? data.collection_id
          : (typeof data.id === 'string' ? data.id : undefined);
        const name: string | undefined = typeof data.name === 'string'
          ? data.name
          : (typeof tc.input?.name === 'string' ? tc.input.name : undefined);
        const modes: { modeId: string; name: string }[] = Array.isArray(data.modes)
          ? data.modes.filter((m: any) => m && typeof m.modeId === 'string' && typeof m.name === 'string')
          : [];
        if (id && name) {
          this.ryowStore.recordCollection({ id, name, modes });
        }
      }
      // ensure_variable / create_variable
      if (toolName === 'ensure_variable' || toolName === 'create_variable') {
        const id: string | undefined = typeof data.variable_id === 'string'
          ? data.variable_id
          : (typeof data.id === 'string' ? data.id : undefined);
        const name: string | undefined = typeof data.name === 'string'
          ? data.name
          : (typeof tc.input?.name === 'string' ? tc.input.name : undefined);
        const collection_id: string | undefined = typeof data.collection_id === 'string'
          ? data.collection_id
          : (typeof tc.input?.collection_id === 'string'
              ? tc.input.collection_id
              : (typeof tc.input?.collection === 'string' ? tc.input.collection : undefined));
        const type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN' | undefined =
          (data.type === 'COLOR' || data.type === 'FLOAT' || data.type === 'STRING' || data.type === 'BOOLEAN')
            ? data.type
            : (typeof tc.input?.type === 'string' &&
                (tc.input.type === 'COLOR' || tc.input.type === 'FLOAT' ||
                 tc.input.type === 'STRING' || tc.input.type === 'BOOLEAN'))
              ? tc.input.type
              : undefined;
        const modeCoverage: string[] = Array.isArray(data.mode_coverage)
          ? data.mode_coverage.filter((s: any) => typeof s === 'string')
          : [];
        const valuesByMode: Record<string, unknown> | undefined =
          (tc.input && typeof tc.input.values_by_mode === 'object' && tc.input.values_by_mode !== null)
            ? tc.input.values_by_mode
            : undefined;
        if (id && name && collection_id && type) {
          this.ryowStore.recordVariable({
            id, name, collection_id, type, mode_coverage: modeCoverage, values_by_mode: valuesByMode,
          });
        }
      }
    }

    // ── 2. Enrich AMBIGUOUS_NAME_AUTOPICK warnings + emit events ──
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      for (const w of result.warnings) {
        if (!w || w.code !== 'AMBIGUOUS_NAME_AUTOPICK') continue;
        // Enrich each candidate with source.
        if (Array.isArray(w.candidates)) {
          for (const c of w.candidates) {
            if (!c || typeof c.variable_id !== 'string') continue;
            c.source = this.ryowStore.isCreatedThisTurn(c.variable_id)
              ? 'created_this_turn'
              : 'preexisting';
          }
        }
        // Suggest the RyowStore-tracked variable matching the picked one's name.
        // The handler doesn't know the bare-name query (it just got "$Foo"),
        // but the picked variable's name + collection metadata is enough to
        // probe RyowStore.
        let nameQuery = '';
        const pickedCandidate = Array.isArray(w.candidates)
          ? w.candidates.find((c: any) => c && c.variable_id === w.picked_variable_id)
          : undefined;
        if (pickedCandidate) {
          nameQuery = String(pickedCandidate.name ?? '');
          const suggestion = this.ryowStore.findVariableByName({
            name: pickedCandidate.name,
            type: pickedCandidate.type,
          });
          if (suggestion && suggestion.id !== w.picked_variable_id) {
            w.suggested_id = suggestion.id;
          }
        }
        // Emit runtime event so dev-bridge can audit.
        this.emitRuntimeEvent({
          type: 'ambiguous_autopick',
          phase: 'execution',
          iteration: this.currentIteration,
          picked_variable_id: w.picked_variable_id,
          suggested_id: w.suggested_id,
          candidates: Array.isArray(w.candidates) ? w.candidates : [],
          tool_name: toolName,
          node_id: typeof w.node_id === 'string' ? w.node_id : undefined,
          name_query: nameQuery,
        });
      }
    }

    // ── 2.5. Emit MISSING_MODE_VALUES events + track failures ──
    // Spec §6 / §5.4. Two surfaces produce this signal:
    //  (a) bind_variable returns error="MISSING_MODE_VALUES: ..." with a
    //      structured data payload (see varHandlers.ts).
    //  (b) variableBindingHandler emits a Warning with code MISSING_MODE_VALUES
    //      that rides as warning.warnings[] from set_fill / jsx — the binding
    //      didn't happen but the rest of the tool succeeded, so it's a warning
    //      not an error.
    this.processMissingModeValues(tc, result);

    // ── 3. Inject _ryow snapshot for variable-related tools ──
    // The store's snapshot() returns undefined for non-variable tools, so
    // attaching unconditionally is safe — but we guard for clarity and to
    // avoid mutating non-variable results.
    if (VARIABLE_RELATED_TOOLS.has(toolName)) {
      const snapshot = this.ryowStore.snapshot(toolName);
      if (snapshot) {
        result._ryow = snapshot;
      }
    }

    return result;
  }

  /**
   * Detect MISSING_MODE_VALUES signals in a tool result and:
   *  1. Emit `missing_mode_values` runtime events.
   *  2. Track failures per-session for rollback detection (spec §5.4).
   *
   * Looks at:
   *  (a) result.error / result.data.code === 'MISSING_MODE_VALUES' (bind_variable)
   *  (b) result.warnings[].code === 'MISSING_MODE_VALUES' (set_fill / jsx)
   */
  private processMissingModeValues(tc: ToolCallBlock, result: any): void {
    if (!result || typeof result !== 'object') return;
    const toolName = tc.name;

    type Failure = {
      node_id: string;
      variable_id: string;
      missing_modes: string[];
    };
    const failures: Failure[] = [];

    // (a) Hard error path (bind_variable).
    if (result.data && result.data.code === 'MISSING_MODE_VALUES') {
      const d = result.data;
      if (typeof d.node_id === 'string' && typeof d.variable_id === 'string'
          && Array.isArray(d.missing_modes)) {
        failures.push({
          node_id: d.node_id,
          variable_id: d.variable_id,
          missing_modes: d.missing_modes.filter((m: any) => typeof m === 'string'),
        });
      }
    }

    // (b) Warning-on-success path (jsx + set_fill emit warnings, the bind
    // call simply did not happen for that property — see variableBindingHandler).
    if (Array.isArray(result.warnings)) {
      for (const w of result.warnings) {
        if (!w || w.code !== 'MISSING_MODE_VALUES') continue;
        const node_id = typeof w.node_id === 'string' ? w.node_id : '';
        const variable_id = typeof w.variable_id === 'string' ? w.variable_id : '';
        const missing_modes = Array.isArray(w.missing_modes)
          ? w.missing_modes.filter((m: any) => typeof m === 'string')
          : [];
        if (node_id && variable_id && missing_modes.length > 0) {
          failures.push({ node_id, variable_id, missing_modes });
        }
      }
    }

    if (failures.length === 0) return;

    const ts = Date.now();
    const phase = this.behaviorConfig.variableResolution;

    // Snapshot RyowStore once per call — used by the rollback heuristic
    // below. The store is per-turn, so the lookup is consistent across all
    // failures captured in a single tool result.
    const ryowSnapshot = this.ryowStore.snapshot('ensure_variable');

    for (const f of failures) {
      // Rollback heuristic (spec §5.4): if RyowStore tracks this variable
      // with the missing modes ALREADY in mode_coverage, it would mean the
      // resolver flagged a coverage that's actually present → resolver bug.
      // Otherwise the variable genuinely lacks modes and the protection is
      // legitimate.
      const tracked = ryowSnapshot?.variables.find(v => v.id === f.variable_id);
      let likely_legitimate = true;
      if (tracked) {
        const trackedSet = new Set(tracked.mode_coverage);
        // If every "missing" mode reported by the resolver is genuinely
        // missing from tracked coverage, protection is legitimate. If at
        // least one missing mode IS in tracked coverage, we have a
        // mismatch worth flagging as a likely false positive.
        likely_legitimate = f.missing_modes.every(m => !trackedSet.has(m));
      }
      this.missingModeValuesFailures.push({
        tool_name: toolName,
        node_id: f.node_id,
        variable_id: f.variable_id,
        missing_modes: f.missing_modes,
        iteration: this.currentIteration,
        likely_legitimate,
        ts,
      });
      this.emitRuntimeEvent({
        type: 'missing_mode_values',
        phase: 'execution',
        iteration: this.currentIteration,
        tool_name: toolName,
        node_id: f.node_id,
        variable_id: f.variable_id,
        missing_modes: f.missing_modes,
        resolutionPhase: phase,
        ts,
      });

      // Per-tool counter — used to emit a single rollback_signal event when
      // false_positive >= ROLLBACK_SIGNAL_THRESHOLD. Counters are NOT cleared
      // at turn boundaries — the signal is per-session per-tool because a
      // resolver bug spanning turns is the regression we want to flag.
      const counters = this.modeCoverageFailureCounters.get(toolName)
        ?? { legit: 0, false_positive: 0 };
      if (likely_legitimate) {
        counters.legit += 1;
      } else {
        counters.false_positive += 1;
      }
      this.modeCoverageFailureCounters.set(toolName, counters);

      if (
        !likely_legitimate
        && counters.false_positive >= ROLLBACK_SIGNAL_THRESHOLD
        && !this.rollbackSignalEmittedFor.has(toolName)
      ) {
        this.rollbackSignalEmittedFor.add(toolName);
        this.emitRuntimeEvent({
          type: 'rollback_signal',
          phase: 'execution',
          iteration: this.currentIteration,
          tool_name: toolName,
          false_positive_count: counters.false_positive,
          ts,
        });
      }
    }
  }

  /**
   * Read-only accessor for tests / dev-bridge: per-tool failure-classification
   * counters. Spec §5.4 / §7.2.
   */
  public getModeCoverageFailureCounters(): ReadonlyMap<string, { legit: number; false_positive: number }> {
    return new Map(this.modeCoverageFailureCounters);
  }

  /**
   * Read-only accessor for tests / dev-bridge: the per-session list of
   * MISSING_MODE_VALUES failures captured so far. Spec §5.4 — Phase 3 of
   * the rollout will use this for auto-revert decisions.
   */
  public getMissingModeValuesFailures(): ReadonlyArray<{
    tool_name: string;
    node_id: string;
    variable_id: string;
    missing_modes: string[];
    iteration: number;
    likely_legitimate: boolean;
    ts: number;
  }> {
    return this.missingModeValuesFailures.slice();
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
    this.turnCounter += 1;
    this.runStartMs = Date.now();
    // Per-turn RYOW store reset (spec §3.3). Subtask child runtimes inherit
    // an empty store anyway because they construct a fresh AgentRuntime, so
    // this only clears the parent's store at the start of each turn.
    this.ryowStore.clear();

    this.emitRuntimeEvent({
      type: 'turn_start',
      phase: 'execution',
      turnNumber: this.turnCounter,
      promptPreview: userPrompt ? userPrompt.slice(0, 200) : undefined,
    });

    // Inject the KNOWLEDGE LIBRARY menu as a user-meta message just before
    // the user prompt — every turn, not just the first.
    //
    // Why every turn: in multi-turn sessions, a menu only injected at turn 1
    // gets pushed far back in conversation history by turn 2+ tool calls and
    // model messages, degrading the attention recall on its content. Re-
    // injecting near each user prompt keeps it adjacent to the active prompt.
    //
    // Why user-meta instead of static system prompt:
    //  - System prompt stays KV-cache-stable across skill/style additions
    //  - Menu sits closer to the user message → higher attention recall
    //  - Allows future incremental updates (only diff new entries since last
    //    turn — see CC's sentSkillNames for the analogous pattern)
    const menu = renderKnowledgeMenu();
    if (menu && menu.trim().length > 0) {
      this.contextManager.addMessage({
        id: this.generateId('km'),
        role: 'user',
        content: `<system-reminder>\n${menu}\n</system-reminder>`,
      });
    }

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
    this.turnCreatedIds = [];
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

      // ──── INTRA-TURN COMPRESSION (DISABLED) ────
      // Disabled to preserve KV-cache hits and full tool-result context.
      // Cross-turn summarization still runs at endTurn() → compressIfNeeded().

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

        // ──── HOOK: beforeTurnEnd ────
        // Last harness-level checkpoint before closing the turn. Stop hooks may
        // veto the end (announce-intent without tool call, provider-side
        // truncation, etc.) and inject a corrective user message. Prompt rules
        // alone can't guarantee these — the while-loop condition does.
        // Model message was already added at line 707-709 (formatResponse +
        // addMessage), so any hook injection will land correctly after it.
        const stopCtx: HookContext = {
          iteration,
          maxIterations: this.maxIterations,
          messages: this.contextManager.getCurrentTurnMessages(),
          loopPolicy: this.loopPolicy,
          generateId: (prefix) => this.generateId(prefix),
          responseText: response.text,
          finishReason: response.finishReason,
        };
        const messagesBeforeStop = this.contextManager.getCurrentTurnMessages().length;
        const stopResult = await this.hookRunner.run('beforeTurnEnd', stopCtx);
        const injectedCount = this.contextManager.getCurrentTurnMessages().length - messagesBeforeStop;
        if (stopResult.action === 'abort') {
          throw new Error(stopResult.reason || 'Aborted by beforeTurnEnd hook');
        }
        if (injectedCount > 0) {
          // A stop hook injected a corrective message — continue the while loop.
          iteration++;
          continue;
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

  /** Backward compat: flat ID list (roots only). */
  public getTurnCreatedNodeIds(): string[] {
    return this.turnCreatedNodes.map(n => n.id);
  }

  /** All IDs created during current turn (roots + descendants). Used to propagate subtask state. */
  public getTurnCreatedIds(): string[] {
    return [...this.turnCreatedIds];
  }

  public getRunStats() {
    return { ...this.runStats };
  }

  public getRunId(): string {
    return this.currentRunId;
  }
}
