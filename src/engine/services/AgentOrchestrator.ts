/**
 * @file AgentOrchestrator.ts
 * @description Orchestrator for the Agentic generation flow.
 * Uses AgentRuntime to perform multi-step, tool-using generations.
 */

import { AgentRuntime, AgentRuntimeCanceledError } from '../agent/agentRuntime';
import { agentTools } from '../agent/tools';
import { createProvider, createProviderFromConfig } from './ProviderFactory';
import type { ProviderConfig } from '../../types/provider';
import { ToolDefinition, ToolExecutor } from '../agent/tools/types';
import { resolveBehavior } from '../agent/agentBehaviorConfig';
import { createSubtaskExecutor, AgentConfig } from '../agent/agentFactory';

import { ThinkingLevel } from '../llm-client/types';
import { emit } from '@create-figma-plugin/utilities';
import { TelemetryService } from './TelemetryService';

import { AgentLoopPolicy, resolveAgentLoopPolicy } from '../agent/agentLoopPolicy';
import { AgentRuntimeEvent } from '../../shared/protocol/agentRuntimeEvents';
import { clearIconCache } from '../figma-adapter/assets/iconify';
import { clearSessionNodes } from '../../ipc/commands/pathResolver';
import { componentRegistry } from '../actions/nodeFactory';
import { LLMProvider } from '../llm-client/providers/types';
import {
  ProviderError,
  isProviderError,
  providerErrorToCode,
  APIError,
} from '../llm-client/providers/shared/providerErrors';

type RuntimeEventPayload = AgentRuntimeEvent extends infer E
  ? E extends any
    ? Omit<E, 'runId' | 'sequence' | 'timestamp'>
    : never
  : never;

export interface AgentPluginData {
  toolExecutors?: Record<string, ToolExecutor>;
  /** Image references for the next user turn — appended as ImageBlocks alongside the text prompt. */
  images?: Array<{ mimeType: string; data: string }>;
}

export interface OrchestratorOptions {
  apiKey: string;
  modelName: string;
  providerName?: string; // Optional: 'gemini' | 'openrouter' | 'proxy'
  /** V2 provider config — when set, used directly via createProviderFromConfig(). */
  providerConfig?: ProviderConfig;
  /** Required when providerName === 'proxy' */
  workerUrl?: string;
  /** Required when providerName === 'proxy' — user's subscription token */
  subscriptionToken?: string;
  tools?: ToolDefinition[]; // Optional: default to agentTools
  thinkingLevel: ThinkingLevel;
  onStatusChange?: (status: string) => void;
  onComplete?: (data: any, rawText?: string) => void;
  onError?: (msg: string) => void;
  onToolCall?: (toolCall: any) => void;
  onToolResult?: (id: string, result: any) => void;
  onIteration?: (iteration: number, response: any, taskInfo?: { taskId: string, taskTitle: string }) => void;
  onIterationStart?: (iteration: number, taskInfo?: { taskId: string, taskTitle: string }) => void;
  loopPolicy?: Partial<AgentLoopPolicy>;
  onRuntimeEvent?: (event: AgentRuntimeEvent) => void;
  locale?: 'en' | 'zh' | 'fr';
}

import { buildStaticSystemPrompt } from '../llm-client/context/system';
import { setContextProfile, deriveContextProfile } from '../agent/context/constants';
import { DEFAULT_PROVIDER_CAPABILITIES } from '../llm-client/providers/types';

import { IpcBridge } from '../agent/ipcBridge';

export class AgentOrchestrator {
  private activeAgent: AgentRuntime | null = null;
  private currentProvider: LLMProvider | null = null;
  private ipcBridge: IpcBridge | null = null;
  private fallbackEventSequence = 0;

  constructor(private options: OrchestratorOptions) {}

  private emitFallbackRuntimeEvent(event: RuntimeEventPayload): void {
    if (!this.options.onRuntimeEvent) return;
    this.fallbackEventSequence += 1;
    this.options.onRuntimeEvent({
      ...event,
      runId: 'orchestrator_fallback',
      sequence: this.fallbackEventSequence,
      timestamp: Date.now(),
    } as AgentRuntimeEvent);
  }

  public cancel(reason: string = 'Canceled by user'): void {
    this.activeAgent?.cancel(reason);
  }

  public endSession(): void {
    // Cancel any in-flight run (including pending approval) before clearing
    this.activeAgent?.cancel('Session ended');
    this.activeAgent = null;
    this.currentProvider = null;
    this.ipcBridge?.dispose();
    this.ipcBridge = null;
    clearIconCache();
    clearSessionNodes();
    componentRegistry.clear();
  }

  public answerQuestion(response: import('../../shared/protocol/agentRuntimeEvents').AskUserResponse | string): void {
    this.activeAgent?.resolveQuestion(response);
  }

  async generate(prompt: string, pluginData: AgentPluginData) {
    const loopPolicy = resolveAgentLoopPolicy(this.options.loopPolicy);

    if (prompt.trim().startsWith('/debug')) {
      this.handleDebugCommand(prompt.trim(), pluginData, loopPolicy);
      return;
    }

    // First turn: create agent + bridge; subsequent turns: reuse
    if (!this.activeAgent) {
      this.ipcBridge = new IpcBridge({ logger: console, defaultTimeoutMs: 30000 });
      this.activeAgent = this.createAgent(pluginData, this.ipcBridge, loopPolicy);
    } else if (pluginData.toolExecutors) {
      // Update executors on existing runtime (e.g. refreshed knowledge search)
      this.activeAgent.mergeToolExecutors(pluginData.toolExecutors);
    }

    // Track outside the try so the catch block can include durationMs in the
    // abort event without re-resolving against an out-of-scope variable.
    const startTime = Date.now();

    try {
      // Selection is now an opt-in tool (get_selection) — no auto-injection here.
      this.options.onStatusChange?.('Agent starting...');
      const finalResponse = await this.activeAgent.run(prompt, pluginData.images);
      const latencyMs = Date.now() - startTime;

      const { tokenUsage } = this.activeAgent.getRunStats();
      TelemetryService.logLLMCall({
        provider: this.options.providerName || 'gemini',
        modelName: this.options.modelName,
        promptTokens: tokenUsage.totalPromptTokens,
        completionTokens: tokenUsage.totalCompletionTokens,
        latencyMs,
        promptText: prompt
      });

      this.options.onComplete?.({}, finalResponse);
      this.emitFallbackRuntimeEvent({
        type: 'turn_end',
        phase: 'idle',
        iteration: 0,
        totalIterations: 0,
        summary: finalResponse || '',
      });
      await this.maybeDebrief(this.activeAgent, 'completed');

    } catch (error: any) {
      console.error('[AgentOrchestrator] Failed:', error);
      if (error instanceof AgentRuntimeCanceledError) {
        this.emitFallbackRuntimeEvent({
          type: 'canceled',
          phase: 'idle',
          reason: error.message || 'Canceled by user',
        });
        return;
      }

      const exitReason = error?.message?.includes('Maximum iterations')
        ? 'max_iterations' as const
        : error?.message?.includes('Aborted by hook')
          ? 'abort' as const
          : 'error' as const;

      // Provider errors carry user-actionable flag + Chinese userMessage from
      // the typed-error layer. Surface those directly to the UI banner.
      if (isProviderError(error)) {
        this.handleProviderError(error, startTime);
      } else {
        const reason = error?.message || 'Generation stopped unexpectedly';
        // Map exitReason to abort category. 'error' has no specific category
        // signal at this layer (ProviderErrors went down the other branch);
        // 'unknown' lets dashboards group these as "untyped runtime exception".
        const abortCategory =
          exitReason === 'max_iterations' ? 'max_iterations' as const
          : exitReason === 'abort' ? 'hook_abort' as const
          : 'unknown' as const;
        const stats = this.activeAgent?.getRunStats();
        this.emitFallbackRuntimeEvent({
          type: 'abort',
          phase: 'idle',
          reason,
          category: abortCategory,
          iteration: this.activeAgent?.getCurrentIteration(),
          toolCallsExecuted: stats?.toolCallCount,
          durationMs: Date.now() - startTime,
        });
        // Extended diagnostic event — sibling to the user-facing turn_end.
        this.emitFallbackRuntimeEvent({
          type: 'error',
          phase: 'idle',
          message: reason,
          code: 'UNKNOWN_ERROR',
          category: 'unknown',
          provider: this.options.providerName,
          originalMessage: error?.message,
          userActionable: false,
          stack: typeof error?.stack === 'string' ? error.stack.slice(0, 2000) : undefined,
        });
        this.emitFallbackRuntimeEvent({
          type: 'status',
          phase: 'idle',
          message: reason,
        });
        this.emitFallbackRuntimeEvent({
          type: 'turn_end',
          phase: 'idle',
          iteration: 0,
          totalIterations: 0,
          summary: `I encountered an issue and couldn't continue: ${reason}`,
        });
      }

      if (this.activeAgent) {
        await this.maybeDebrief(this.activeAgent, exitReason);
      }
    }
  }

  private emitDebugComplete(summary: string): void {
    this.emitFallbackRuntimeEvent({
      type: 'turn_end',
      phase: 'idle',
      iteration: 0,
      totalIterations: 0,
      summary: `[Debug] ${summary}`,
    });
  }

  /**
   * Handle /debug commands. Dumps system prompt and agent config to console.
   */
  private handleDebugCommand(
    command: string,
    pluginData: AgentPluginData,
    loopPolicy: AgentLoopPolicy
  ): void {
    const subCommand = command.replace(/^\/debug\s*/, '').trim() || 'prompt';

    if (subCommand === 'prompt' || subCommand === 'system') {
      // Build the same system prompt that createAgent would produce
      const {
        modelName,
        thinkingLevel,
        tools = agentTools
      } = this.options;
      const providerName = this.options.providerName || 'gemini';

      const behaviorConfig = resolveBehavior({
        thinkingLevel,
      });

      // Main runtime: skip menu in static prompt — agentRuntime injects it
      // as a per-turn user-meta message (closer to user, KV-cache-stable system).
      const systemPrompt = buildStaticSystemPrompt(tools, { getToolSystemInstruction: () => '' }, this.options.locale, { includeMenu: false });

      // Dump to console
      console.log('\n' + '='.repeat(80));
      console.log('DEBUG: FULL SYSTEM PROMPT');
      console.log('='.repeat(80));
      console.log(`Provider: ${providerName} | Model: ${modelName} | Thinking: ${thinkingLevel}`);
      console.log(`Behavior: thinking=${behaviorConfig.thinkingLevel}`);
      console.log(`Tools: ${tools.length} (${tools.map(t => t.name).join(', ')})`);
      console.log('-'.repeat(80));
      console.log(systemPrompt);
      console.log('='.repeat(80) + '\n');

      this.emitDebugComplete(`System prompt dumped to console (~${Math.ceil(systemPrompt.length / 4)} tokens). Open DevTools → Console to copy.`);
    } else if (subCommand === 'skills') {
      console.log('\n' + '='.repeat(80));
      console.log('DEBUG: SKILL REGISTRY');
      console.log('='.repeat(80));
      const knowledgeIndex = require('../../generated/knowledge-index.json') as Array<{
        id: string;
        name: string;
        description: string;
        category: string;
      }>;
      const skillEntries = knowledgeIndex.filter(e => e.category === 'skill');
      for (const skill of skillEntries) {
        console.log(`  ${skill.id} — ${skill.description}`);
      }
      console.log('='.repeat(80) + '\n');
      this.emitDebugComplete(`${skillEntries.length} skills dumped to console.`);
    } else if (subCommand === 'config') {
      console.log('\n' + '='.repeat(80));
      console.log('DEBUG: AGENT CONFIG');
      console.log('='.repeat(80));
      console.log('Loop Policy:', JSON.stringify(loopPolicy, null, 2));
      const behaviorConfig = resolveBehavior({
        thinkingLevel: this.options.thinkingLevel,
      });
      console.log('Behavior Config:', JSON.stringify(behaviorConfig, null, 2));
      console.log('='.repeat(80) + '\n');
      this.emitDebugComplete(`Agent config dumped to console.`);
    } else {
      this.emitDebugComplete(`Unknown sub-command: "${subCommand}". Available: /debug prompt, /debug skills, /debug config`);
    }
  }

  /**
   * Creates and configures the AgentRuntime with the appropriate provider and tools.
   */
  private createAgent(
    pluginData: AgentPluginData,
    ipcBridge: IpcBridge,
    loopPolicy?: AgentLoopPolicy,
  ): AgentRuntime {
    const {
      thinkingLevel,
      tools = agentTools,
    } = this.options;

    // Priority: 1. V2 providerConfig, 2. Legacy providerName, 3. Default Gemini
    const { providerConfig } = this.options;

    let provider: LLMProvider;
    let resolvedDisplayName: string;

    if (providerConfig) {
      const out = createProviderFromConfig(providerConfig);
      provider = out.provider;
      resolvedDisplayName = out.resolvedDisplayName;
    } else {
      const providerName = this.options.providerName || 'gemini';
      const out = createProvider({
        providerName,
        modelName: this.options.modelName,
        apiKey: this.options.apiKey,
        workerUrl: this.options.workerUrl,
        subscriptionToken: this.options.subscriptionToken,
      });
      provider = out.provider;
      resolvedDisplayName = out.resolvedDisplayName;
    }
    const modelName = providerConfig?.modelId || this.options.modelName;
    emit('SEND_LOG', { message: `Using ${resolvedDisplayName}: ${modelName}`, type: 'ai' });

    const resolvedLoopPolicy = loopPolicy || resolveAgentLoopPolicy(this.options.loopPolicy);

    // Unified behavior resolution (single entry point)
    const behaviorConfig = resolveBehavior({
      thinkingLevel,
    });

    console.log(`[AgentOrchestrator] Behavior resolved: thinking=${behaviorConfig.thinkingLevel}`);

    // Select context profile from provider's declared context window (not regex guessing)
    const contextWindow = provider.getCapabilities?.().contextWindow ?? DEFAULT_PROVIDER_CAPABILITIES.contextWindow;
    const contextProfile = deriveContextProfile(contextWindow);
    setContextProfile(contextProfile);
    console.log(`[AgentOrchestrator] Context profile: ${contextWindow >= 100_000 ? 'RELAXED' : 'TIGHT'} (contextWindow: ${contextWindow}, model: ${modelName})`);

    // Build static system prompt (set once, never changes — enables KV cache).
    // Menu is injected per-turn by agentRuntime (see run()), keeping this
    // string stable across turns even as new skills/styles are added.
    const systemPrompt = buildStaticSystemPrompt(tools, provider, undefined, { includeMenu: false });

    this.currentProvider = provider;

    const runtime = new AgentRuntime({
      provider,
      tools,
      systemPrompt,
      ipcBridge,
      toolExecutors: pluginData.toolExecutors,
      behaviorConfig,
      loopPolicy: resolvedLoopPolicy,
      contextWindow,
      onIteration: (iteration: number, response: any, taskInfo?: any) => this.options.onIteration?.(iteration, response, taskInfo),
      onToolCall: this.handleToolCall.bind(this),
      onToolResult: this.handleToolResult.bind(this),
      onIterationStart: (iteration: number, taskInfo?: any) => this.options.onIterationStart?.(iteration, taskInfo),
      onRuntimeEvent: (event) => this.options.onRuntimeEvent?.(event),
    });

    // Inject subtask executor externally (not a constructor side-effect).
    // The closure reads LIVE state (iteration, executors, abort signal) at invocation time.
    if (tools.some(t => t.name === 'subtask')) {
      const parentConfig: AgentConfig = {
        provider,
        tools,
        toolExecutors: {},  // placeholder — overridden at call time with live executors
        systemPrompt,
        behaviorConfig,
        maxIterations: behaviorConfig.maxIterations || 40,
        ipcBridge,
        onRuntimeEvent: (event) => this.options.onRuntimeEvent?.(event),
        contextWindow,
      };
      runtime.mergeToolExecutors({
        subtask: createSubtaskExecutor(
          parentConfig,
          {
            getCurrentIteration: () => runtime.getCurrentIteration(),
            getMaxIterations: () => runtime.getMaxIterations(),
            getRunAbortSignal: () => runtime.getRunAbortSignal(),
            getActiveExecutors: () => runtime.getActiveExecutors(),
          },
          0,  // depth
          2,  // maxDepth
        ),
      });
    }

    return runtime;
  }

  // ==========================================
  // POST-RUN DEBRIEF
  // ==========================================

  /**
   * After a difficult run, ask the LLM to reflect on tool usability.
   * Non-fatal: swallows errors silently.
   *
   * Builds context from the agent's own message history (not stale UI history)
   * and emits the debrief event with the agent's real runId so useChat routes
   * it to the correct ChatMessage.
   */
  private async maybeDebrief(
    agent: AgentRuntime,
    exitReason: 'completed' | 'max_iterations' | 'abort' | 'error',
  ): Promise<void> {
    if (!this.currentProvider) return;

    const stats = agent.getRunStats();
    const errorRate = stats.toolCallCount > 0
      ? stats.toolErrorCount / stats.toolCallCount
      : 0;

    // Trigger conditions: any difficulty signal
    const shouldDebrief =
      exitReason !== 'completed' ||
      stats.loopDetected ||
      errorRate > 0.3;

    if (!shouldDebrief) return;

    try {
      // Build a compact digest from the agent's own LLM conversation,
      // which contains the actual tool calls/results from this run.
      const agentMessages = agent.getMessages();
      const digestLines: string[] = ['=== RUN DIGEST ==='];
      digestLines.push(`Exit: ${exitReason} | Tools: ${stats.toolCallCount} calls, ${stats.toolErrorCount} errors | Loop: ${stats.loopDetected}`);
      let toolIdx = 0;
      for (const msg of agentMessages) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content as any[]) {
          if (part.functionCall) {
            toolIdx++;
            digestLines.push(`#${toolIdx} [${part.functionCall.name}] args: ${JSON.stringify(part.functionCall.args ?? {}).slice(0, 120)}`);
          }
          if (part.functionResponse) {
            const err = part.functionResponse.response?.error;
            digestLines.push(`  → ${err ? 'ERR' : 'OK'}${err ? `: ${JSON.stringify(err).slice(0, 100)}` : ''}`);
          }
        }
      }
      digestLines.push('=== END DIGEST ===');
      const digest = digestLines.join('\n');

      const debriefPrompt = `You just completed a Figma design generation run that had difficulties. Here is a summary:

${digest}

Evaluate your experience as a tool user:
1. **Confusing Tools**: Which tools had confusing APIs or unclear parameters?
2. **Hard Parts**: What kept failing? What was the hardest part?
3. **Suggestions**: What would have helped you succeed? (Better errors, different APIs, more examples?)

Be specific — name exact tools, parameters, and error messages. Keep it under 200 words.`;

      const response = await this.currentProvider.generate({
        messages: [{ id: `debrief_${Date.now()}`, role: 'user', content: debriefPrompt }],
        maxTokens: 500,
        thinkingLevel: 'minimal',
      });

      const debriefText = response.text || '';
      if (!debriefText) return;

      // Try to parse structured feedback from the text
      const structured = this.parseDebriefStructure(debriefText);

      // Emit with the agent's real runId so useChat can route it
      // to the correct ChatMessage (not 'orchestrator_fallback').
      const runId = agent.getRunId() || 'orchestrator_fallback';
      if (this.options.onRuntimeEvent) {
        this.fallbackEventSequence += 1;
        this.options.onRuntimeEvent({
          type: 'debrief',
          runId,
          sequence: this.fallbackEventSequence,
          timestamp: Date.now(),
          phase: 'idle',
          exitReason,
          totalIterations: stats.toolCallCount, // approximate from tool calls
          errorCount: stats.toolErrorCount,
          loopsDetected: stats.loopDetected,
          debrief: debriefText,
          structured,
        } as AgentRuntimeEvent);
      }

      console.log('[AgentOrchestrator] Debrief collected:', debriefText.slice(0, 200));
    } catch (err) {
      console.warn('[AgentOrchestrator] Debrief failed (non-fatal):', err);
    }
  }

  private parseDebriefStructure(text: string): {
    confusingTools: string[];
    hardParts: string[];
    suggestions: string[];
  } | undefined {
    try {
      // Simple heuristic extraction from numbered sections
      const sections = text.split(/\d+\.\s*\*\*/);
      if (sections.length < 3) return undefined;

      const extractItems = (section: string): string[] =>
        section.split(/[-•\n]/)
          .map(s => s.replace(/\*\*/g, '').trim())
          .filter(s => s.length > 5);

      return {
        confusingTools: extractItems(sections[1] || ''),
        hardParts: extractItems(sections[2] || ''),
        suggestions: extractItems(sections[3] || ''),
      };
    } catch {
      return undefined;
    }
  }

  // ==========================================
  // ERROR CLASSIFICATION
  // ==========================================

  /**
   * Surface a typed ProviderError. The error itself decides whether the UI
   * should show an actionable banner — `userActionable` + `userMessage` are
   * set at the source and propagate unchanged.
   */
  private handleProviderError(error: ProviderError, startTime?: number): void {
    const code = providerErrorToCode(error);
    const technicalMessage = error.message;
    const userMessage = error.userMessage;

    if (error.userActionable) {
      // Actionable: UI banner + retry CTA. The error event carries diagnostic
      // detail; the user-facing message stays in `message`.
      this.emitFallbackRuntimeEvent({
        type: 'error',
        phase: 'idle',
        message: userMessage,
        code,
        category: error.category,
        provider: error.providerName,
        originalMessage: technicalMessage,
        userActionable: true,
      });
      this.options.onError?.(userMessage);
      console.warn(`[AgentOrchestrator] ${code}: ${technicalMessage}`);
    } else {
      // Non-actionable: previously emitted only status + turn_end, leaving
      // operators with no telemetry on why the run stopped. Now emits abort
      // (with category) + error (with provider/category) before the existing
      // user-facing pair.
      const abortCategory = error.category === 'transport' ? 'network' as const : 'provider_error' as const;
      this.emitFallbackRuntimeEvent({
        type: 'abort',
        phase: 'idle',
        reason: userMessage,
        category: abortCategory,
        iteration: this.activeAgent?.getCurrentIteration(),
        toolCallsExecuted: this.activeAgent?.getRunStats().toolCallCount,
        durationMs: typeof startTime === 'number' ? Date.now() - startTime : undefined,
      });
      this.emitFallbackRuntimeEvent({
        type: 'error',
        phase: 'idle',
        message: userMessage,
        code,
        category: error.category,
        provider: error.providerName,
        originalMessage: technicalMessage,
        userActionable: false,
      });
      this.emitFallbackRuntimeEvent({
        type: 'status',
        phase: 'idle',
        message: userMessage,
      });
      this.emitFallbackRuntimeEvent({
        type: 'turn_end',
        phase: 'idle',
        iteration: 0,
        totalIterations: 0,
        summary: `I encountered an issue and couldn't continue: ${userMessage}`,
      });
      console.warn(`[AgentOrchestrator] ${code} (non-actionable): ${technicalMessage}`);
    }
  }

  // ==========================================
  // REUSABLE CALLBACK HANDLERS
  // ==========================================

  private handleToolCall(tc: any) {
    this.options.onStatusChange?.(`Executing tool: ${tc.name}...`);
    this.options.onToolCall?.(tc);
  }

  private handleToolResult(tc: any, result: any) {
    this.options.onToolResult?.(tc.id, result);
  }
}
