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
import { AgentRuntimeEvent } from '../../shared/protocol/agentRuntimeEvents';
import { LLMGenerationCoordinator } from './llmGenerationCoordinator';
import { ToolDispatcher } from './toolDispatcher';
import { TOOL_NAMES } from './tools/unified';
import { clearOverflows } from './overflowStore';
import { executeSubtask } from './subtask/executor';
import type { SubtaskContext } from './subtask/types';
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
  private currentRunId = '';
  private eventSequence = 0;
  private canceledEventEmitted = false;
  private pendingApproval: { resolve: (approved: boolean) => void } | null = null;
  private chatPanelId: string | null = null;
  private turnCreatedNodeIds: string[] = [];
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
        toolTimeoutMs: AGENT_RUNTIME_CONSTANTS.DEFAULT_TOOL_TIMEOUT_MS,
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
            messages: this.contextManager.getTurnMessages(),
            loopPolicy: this.loopPolicy,
            generateId: (prefix) => this.generateId(prefix),
          };
          const result = await this.hookRunner.run('beforeToolExec', ctx);
          if (result.action === 'skip' || result.action === 'abort') {
            return { action: result.action, reason: result.reason };
          }
          return undefined;
        },
        afterToolExec: async (tc, toolResult) => {
          const ctx: HookContext = {
            iteration: this.currentIteration,
            maxIterations: this.maxIterations,
            currentToolCall: tc,
            toolResult,
            messages: this.contextManager.getTurnMessages(),
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

    // Register subtask executor (bounded self-recursion)
    this.toolDispatcher.mergeExecutors({
      subtask: async (args: any) => {
        const childContext: SubtaskContext = {
          provider: this.options.provider,
          ipcBridge: this.options.ipcBridge,
          systemPrompt: this.contextManager.getSystemPrompt(),
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
      [{ id: this.generateId('user-msg'), name: 'render', args: { markup, parentId: panelId } }],
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
    if (this.turnCreatedNodeIds.length > 0) {
      this.designRootId = this.turnCreatedNodeIds[0];
    }
    // Add hyperlink: current turn's root, or fallback to previous turn's design
    const linkNodeId = this.turnCreatedNodeIds.length > 0
      ? this.turnCreatedNodeIds[0]
      : this.designRootId;
    if (linkNodeId) {
      markupLines.push(`  link-text [link:NODE:${linkNodeId}]: → View design`);
    }

    const markup = markupLines.join('\n');
    await this.toolDispatcher.dispatch(
      [{ id: this.generateId('bubble'), name: 'render', args: { markup, parentId: panelId } }],
      iteration,
    );
  }

  /**
   * Extract the root design node ID from tool result data.
   * For chains, picks the shallowest path (fewest `/` segments) — the design root.
   */
  private collectCreatedNodeIds(data: any): void {
    // Direct idMap (non-chained commands like single mk)
    if (!data.chain && data.idMap && typeof data.idMap === 'object') {
      const ids = Object.values(data.idMap) as string[];
      if (ids.length > 0) this.turnCreatedNodeIds.push(String(ids[0]));
      return;
    }
    // Chained commands (&&): find the shallowest path's node ID
    if (Array.isArray(data.chain)) {
      let bestId: string | null = null;
      let bestDepth = Infinity;
      for (const step of data.chain) {
        const idMap = step.data?.idMap;
        if (!idMap || typeof idMap !== 'object') continue;
        const ids = Object.values(idMap) as string[];
        if (ids.length === 0) continue;
        // Extract path depth from command string: "mk /A/B/C ..." → depth 3
        const cmd = step.command || '';
        const pathMatch = cmd.match(/\/([\w/]+)\//);
        const depth = pathMatch ? pathMatch[1].split('/').length : Infinity;
        if (depth < bestDepth) {
          bestDepth = depth;
          bestId = String(ids[0]);
        }
      }
      if (bestId) this.turnCreatedNodeIds.push(bestId);
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

    // Clear previous turn's messages (already moved to conversationHistory by endTurn)
    this.contextManager.startTurn();

    // Add user message to current turn
    this.contextManager.pushToTurn({
      id: this.generateId('usr'),
      role: 'user',
      content: userPrompt,
    });

    let iteration = 0;
    let truncationCount = 0;
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

    // ── Load persistent memory on first turn ──
    if (this.contextManager.isFirstTurn() && this.options.ipcBridge) {
      try {
        const memResult = await Promise.race([
          this.options.ipcBridge.callTool('list_memories', {}),
          new Promise<null>(r => setTimeout(() => r(null), 2000)),
        ]);
        if (memResult && !memResult.error && memResult.data?.memories) {
          const memories = memResult.data.memories as Record<string, string>;
          const keys = Object.keys(memories);
          if (keys.length > 0) {
            const memoryText = keys.map(k => `- ${k}: ${memories[k]}`).join('\n');
            this.contextManager.unshiftToTurn({
              id: this.generateId('mem'),
              role: 'user',
              content: `[System: Loaded ${keys.length} persistent memories from previous sessions]\n${memoryText}`,
              hidden: true,
            });
            this.emitRuntimeEvent({
              type: 'status',
              phase: 'execution',
              message: `Memory loaded (${keys.length} items)`,
              iteration: 0,
              maxIterations: this.maxIterations,
              memoryCount: keys.length,
            });
          }
        }
      } catch (e) {
        console.warn('[Memory] Failed to load persistent memory (non-fatal):', e);
      }

      // ── Token scan: Memory Diff + Onboarding ──
      try {
        const scanResult = await Promise.race([
          this.options.ipcBridge.callTool('scan-tokens', {}),
          new Promise<null>(r => setTimeout(() => r(null), 3000)),
        ]);
        if (scanResult && !scanResult.error && scanResult.data) {
          const { snapshot, summary, tokenCount } = scanResult.data;
          if (tokenCount > 0) {
            // Try to load previous snapshot for diff
            const prevSnapshotResult = await Promise.race([
              this.options.ipcBridge.callTool('list_memories', { key: '_token_snapshot' }),
              new Promise<null>(r => setTimeout(() => r(null), 1000)),
            ]);

            let diffText = '';
            if (prevSnapshotResult && !prevSnapshotResult.error && prevSnapshotResult.data?.value) {
              try {
                const { diffTokenSnapshots } = await import('./context/tokenDiffer');
                const prevSnapshot = JSON.parse(prevSnapshotResult.data.value);
                const diff = diffTokenSnapshots(prevSnapshot, snapshot);
                if (diff && diff.hasChanges) {
                  diffText = `\n\n[Design system changes since last session]\n${diff.summary}`;
                }
              } catch { /* ignore parse errors */ }
            }

            // Inject token context (onboarding or diff)
            this.contextManager.unshiftToTurn({
              id: this.generateId('tok'),
              role: 'user',
              content: `[System: Design tokens detected — ${summary}]${diffText}`,
              hidden: true,
            });

            // Save current snapshot for next session's diff
            this.options.ipcBridge.callTool('save_memory', {
              key: '_token_snapshot',
              value: JSON.stringify(snapshot),
            }).catch(() => { /* non-fatal */ });
          }
        }
      } catch (e) {
        console.warn('[TokenScan] Failed to scan design tokens (non-fatal):', e);
      }
    }

    // ── Render user message in chat panel ──
    this.turnCreatedNodeIds = [];
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
        messages: this.contextManager.getTurnMessages(),
        loopPolicy: this.loopPolicy,
        generateId: (prefix) => this.generateId(prefix),
      };
      const beforeIterResult = await this.hookRunner.run('beforeIteration', beforeIterCtx);
      if (beforeIterResult.action === 'abort') {
        throw new Error(beforeIterResult.reason || 'Aborted by beforeIteration hook');
      }

      const prompt = this.contextManager.assemblePrompt();
      const currentTokens = this.contextManager.getLastPromptTokens();

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
      // All tools are first-class now — no unwrapping needed
      const rawCalls = rawToolCallsForLoopDetection.length > 0 ? rawToolCallsForLoopDetection : toolCallsForExecution;
      const hookCtx: HookContext = {
        iteration,
        maxIterations: this.maxIterations,
        responseText: response.text,
        toolCalls: rawCalls,
        messages: this.contextManager.getTurnMessages(),
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
      this.contextManager.pushToTurn(modelMessage);

      this.contextManager.setLastPromptTokens(response.usage?.promptTokens ?? this.contextManager.getLastPromptTokens());
      if (response.usage) {
        this.runStats.tokenUsage.totalPromptTokens += response.usage.promptTokens;
        this.runStats.tokenUsage.totalCompletionTokens += response.usage.completionTokens;
        this.runStats.tokenUsage.totalTokens += response.usage.totalTokens;
        this.runStats.tokenUsage.callCount++;
      }

      // ──── TRUNCATION GUARD (with tool calls) ────
      // When finishReason='length' AND tool calls exist, the calls are likely truncated
      // (e.g., incomplete JSX → "Unterminated JSX contents" errors).
      // Discard truncated calls and ask LLM to retry with simpler output.
      if (toolCallsForExecution.length > 0 && response.finishReason === 'length') {
        truncationCount++;
        const truncatedNames = toolCallsForExecution.map(tc => tc.name).join(', ');
        console.warn(`[AgentRuntime] Tool calls truncated (finishReason=length, tools=[${truncatedNames}], ${truncationCount}/3). Discarding.`);
        if (truncationCount <= 3) {
          this.contextManager.pushToTurn({
            id: this.generateId('cont'),
            role: 'user',
            content: `Your previous response was truncated mid-tool-call (finishReason=length). The tool calls were discarded because they contain incomplete parameters. To fix this: break your design into smaller parts — create fewer nodes per tool call, or split into multiple sequential calls.`,
            synthetic: true,
          });
          continue;
        }
        // After 3 truncation retries, let tool calls through (they'll fail with parse errors,
        // but loop detection will eventually abort).
        console.warn(`[AgentRuntime] Truncation limit reached (3) with tool calls. Proceeding with truncated calls.`);
      }

      // ──── TOOL EXECUTION ────
      // Empty-args filtering is handled by builtin hooks:
      //   emptyArgsCounter (afterLLMResponse) → counts/aborts/injects hint
      //   emptyArgsSkip (beforeToolExec) → skips individual empty-args calls
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
            this.contextManager.pushToTurn({ id: this.generateId('usr'), role: 'user', content: 'Tools denied by user. Try a different approach.', synthetic: true });
            iteration++;
            continue;
          }
        }
        this.runStats.toolCallCount += toolCallsForExecution.length;
        const dispatchResult = await this.toolDispatcher.dispatch(toolCallsForExecution, iteration);
        const content = dispatchResult.toolResultsMessage.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part.functionResponse?.response?.error != null) {
              this.runStats.toolErrorCount++;
            }
            // Track created node IDs for design link generation
            const data = (part as any).functionResponse?.response?.data;
            if (data) {
              this.collectCreatedNodeIds(data);
            }
          }
        }
        this.contextManager.pushToTurn(dispatchResult.toolResultsMessage);

        // Guardrails (consecutiveFailure, partialFailure, budget) are now
        // handled by builtin afterIteration hooks.

        // ──── HOOK: afterIteration ────
        // Collect per-tool results for iteration-level analysis hooks
        const iterationToolResults: Array<{ toolCall: LLMToolCall; result: any }> = [];
        if (Array.isArray(content)) {
          for (let i = 0; i < toolCallsForExecution.length && i < content.length; i++) {
            iterationToolResults.push({
              toolCall: toolCallsForExecution[i],
              result: (content[i] as any)?.functionResponse?.response,
            });
          }
        }
        const afterIterCtx: HookContext = {
          iteration,
          maxIterations: this.maxIterations,
          messages: this.contextManager.getTurnMessages(),
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
        // ──── TRUNCATION GUARD ────
        // If finishReason is present and NOT 'stop', the response was truncated.
        // Bounded: max 3 continuations before forcing turn end.
        const fr = response.finishReason;
        if (fr && fr !== 'stop' && fr !== 'tool_calls') {
          truncationCount++;
          if (truncationCount <= 3) {
            console.warn(`[AgentRuntime] Response truncated (finishReason=${fr}, ${truncationCount}/3). Injecting continuation.`);
            this.contextManager.pushToTurn({
              id: this.generateId('cont'),
              role: 'user',
              content: 'Your previous response was truncated. Continue where you left off.',
              synthetic: true,
            });
            // Don't increment iteration — truncation continuation is the same logical step
            continue;
          }
          console.warn(`[AgentRuntime] Truncation limit reached (3). Forcing turn end.`);
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
        });
        this.contextManager.endTurn();
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
    this.contextManager.endTurn();
    return `I've used all ${this.maxIterations} iterations. My progress is saved — say "continue" to pick up where I left off.`;
  }

  /** Returns current turn messages (for debrief/diagnostics). */
  public getMessages(): LLMMessage[] {
    return this.contextManager.getTurnMessages();
  }

  public getRunStats() {
    return { ...this.runStats };
  }

  public getRunId(): string {
    return this.currentRunId;
  }
}
