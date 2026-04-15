/**
 * @file AgentOrchestrator.ts
 * @description Orchestrator for the Agentic generation flow.
 * Uses AgentRuntime to perform multi-step, tool-using generations.
 */

import { AgentRuntime, AgentRuntimeCanceledError } from '../agent/agentRuntime';
import { GeminiProvider, OpenRouterProvider, DashScopeProvider, AnthropicProvider, ANTHROPIC_CONFIG } from '../llm-client';
import { ProxyProvider } from '../llm-client/providers/proxy';
import { agentTools } from '../agent/tools';
import { ToolDefinition, ToolExecutor } from '../agent/tools/types';
import { resolveBehavior } from '../agent/agentBehaviorConfig';
import { createSubtaskExecutor, AgentConfig } from '../agent/agentFactory';

import { ThinkingLevel } from '../llm-client/types';
import { emit } from '@create-figma-plugin/utilities';
import { TelemetryService } from './TelemetryService';

import { initializeSkills, skillRegistry } from '../agent/skills';
import { AgentLoopPolicy, resolveAgentLoopPolicy } from '../agent/agentLoopPolicy';
import { AgentRuntimeEvent } from '../../shared/protocol/agentRuntimeEvents';
import { clearIconCache } from '../figma-adapter/assets/iconify';
import { clearSessionNodes } from '../../ipc/commands/pathResolver';
import { clearComponentRegistry } from '../actions/nodeFactory';
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
}

export interface OrchestratorOptions {
  apiKey: string;
  modelName: string;
  providerName?: string; // Optional: 'gemini' | 'openrouter' | 'proxy'
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
  private static initializationPromise: Promise<void> | null = null;
  private activeAgent: AgentRuntime | null = null;
  private currentProvider: LLMProvider | null = null;
  private ipcBridge: IpcBridge | null = null;
  private fallbackEventSequence = 0;

  constructor(private options: OrchestratorOptions) {}

  private static async ensureSkillsInitialized(enabled: boolean): Promise<void> {
    if (!enabled) return;
    
    if (!AgentOrchestrator.initializationPromise) {
      AgentOrchestrator.initializationPromise = initializeSkills();
    }
    
    return AgentOrchestrator.initializationPromise;
  }

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
    clearComponentRegistry();
  }

  public answerQuestion(answer: string): void {
    this.activeAgent?.resolveQuestion(answer);
  }

  async generate(prompt: string, pluginData: AgentPluginData) {
    const loopPolicy = resolveAgentLoopPolicy(this.options.loopPolicy);
    await AgentOrchestrator.ensureSkillsInitialized(loopPolicy.useSkillSystem);

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

    try {
      // Selection is now an opt-in tool (get_selection) — no auto-injection here.
      this.options.onStatusChange?.('Agent starting...');
      const startTime = Date.now();
      const finalResponse = await this.activeAgent.run(prompt);
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
        this.handleProviderError(error);
      } else {
        const reason = error?.message || 'Generation stopped unexpectedly';
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
        promptPolicy: { useSkillSystem: loopPolicy.useSkillSystem }
      });

      const systemPrompt = buildStaticSystemPrompt(tools, { getToolSystemInstruction: () => '' }, this.options.locale);

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
      const allSkills = skillRegistry.getAll();
      for (const skill of allSkills) {
        const state = skillRegistry.getState(skill.id);
        console.log(`  [${state?.enabled ? 'ON' : 'OFF'}] ${skill.id} — ${skill.description}`);
      }
      console.log('='.repeat(80) + '\n');
      this.emitDebugComplete(`${allSkills.length} skills dumped to console.`);
    } else if (subCommand === 'config') {
      console.log('\n' + '='.repeat(80));
      console.log('DEBUG: AGENT CONFIG');
      console.log('='.repeat(80));
      console.log('Loop Policy:', JSON.stringify(loopPolicy, null, 2));
      const behaviorConfig = resolveBehavior({
        thinkingLevel: this.options.thinkingLevel,
        promptPolicy: { useSkillSystem: loopPolicy.useSkillSystem }
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
      apiKey,
      modelName,
      thinkingLevel,
      tools = agentTools
    } = this.options;

    // Priority: 1. Explicit providerName, 2. Default to Gemini
    // [FIX] Removed heuristic auto-detection that overrode explicit user choice (e.g. modelName having '/')
    let providerName = this.options.providerName || 'gemini';

    // Initialize Provider
    let provider: LLMProvider;
    if (providerName === 'openrouter') {
      provider = new OpenRouterProvider(apiKey, modelName);
      emit('SEND_LOG', { message: `Using OpenRouter: ${modelName}`, type: 'ai' });
    } else if (providerName === 'dashscope') {
      const workerUrl = this.options.workerUrl;
      let fetchProxy;
      if (workerUrl) {
        // Sync fallback: Route through Worker CORS proxy (sandbox fetch → Worker → DashScope)
        fetchProxy = async (_url: string, init: any) => {
          const res = await fetch(`${workerUrl}/api/dashscope/generate-sync`, {
            method: 'POST',
            headers: init.headers,
            body: init.body,
          });
          const body = await res.text();
          return { ok: res.ok, status: res.status, body };
        };
      }
      // workerUrl enables streaming (SSE via /api/dashscope/generate); fetchProxy is sync fallback
      provider = new DashScopeProvider(apiKey, modelName, fetchProxy, workerUrl);
      emit('SEND_LOG', { message: `Using DashScope: ${modelName}`, type: 'ai' });
    } else if (providerName === 'claude') {
      // Auto-detect: sk-ant- prefix = native Anthropic, otherwise DashScope-compatible
      const isNativeKey = apiKey.startsWith('sk-ant-');
      const baseUrl = isNativeKey ? undefined : ANTHROPIC_CONFIG.DASHSCOPE_BASE_URL;
      provider = new AnthropicProvider(apiKey, modelName, baseUrl);
      emit('SEND_LOG', { message: `Using Claude${isNativeKey ? '' : ' (DashScope)'}: ${modelName}`, type: 'ai' });
    } else if (providerName === 'proxy') {
      const workerUrl = this.options.workerUrl;
      const subscriptionToken = this.options.subscriptionToken;
      if (!workerUrl || !subscriptionToken) {
        throw new Error('[AgentOrchestrator] ProxyProvider requires workerUrl and subscriptionToken');
      }
      provider = new ProxyProvider(workerUrl, subscriptionToken, modelName);
      emit('SEND_LOG', { message: `Using Proxy (${workerUrl}): ${modelName}`, type: 'ai' });
    } else {
      // Default to Gemini (existing behavior)
      provider = new GeminiProvider(apiKey, modelName);
      emit('SEND_LOG', { message: `Using Gemini: ${modelName}`, type: 'ai' });
    }

    const resolvedLoopPolicy = loopPolicy || resolveAgentLoopPolicy(this.options.loopPolicy);

    // Unified behavior resolution (single entry point)
    const behaviorConfig = resolveBehavior({
      thinkingLevel,
      promptPolicy: {
        useSkillSystem: resolvedLoopPolicy.useSkillSystem
      }
    });

    console.log(`[AgentOrchestrator] Behavior resolved: thinking=${behaviorConfig.thinkingLevel}`);

    // Select context profile from provider's declared context window (not regex guessing)
    const contextWindow = provider.getCapabilities?.().contextWindow ?? DEFAULT_PROVIDER_CAPABILITIES.contextWindow;
    const contextProfile = deriveContextProfile(contextWindow);
    setContextProfile(contextProfile);
    console.log(`[AgentOrchestrator] Context profile: ${contextWindow >= 100_000 ? 'RELAXED' : 'TIGHT'} (contextWindow: ${contextWindow}, model: ${modelName})`);

    // Build static system prompt (set once, never changes — enables KV cache)
    const systemPrompt = buildStaticSystemPrompt(tools, provider);

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
  private handleProviderError(error: ProviderError): void {
    const code = providerErrorToCode(error);
    const technicalMessage = error.message;
    const userMessage = error.userMessage;

    if (error.userActionable) {
      this.emitFallbackRuntimeEvent({
        type: 'error',
        phase: 'idle',
        message: userMessage,
        code,
      });
      this.options.onError?.(userMessage);
      console.warn(`[AgentOrchestrator] ${code}: ${technicalMessage}`);
    } else {
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
