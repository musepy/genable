/**
 * @file AgentOrchestrator.ts
 * @description Orchestrator for the Agentic generation flow.
 * Uses AgentRuntime to perform multi-step, tool-using generations.
 */

import { AgentRuntime, AgentRuntimeCanceledError } from '../agent/agentRuntime';
import { GeminiProvider, OpenRouterProvider } from '../llm-client';
import { ProxyProvider } from '../llm-client/providers/proxy';
import { agentTools } from '../agent/tools';
import { ToolDefinition, ToolExecutor } from '../agent/tools/types';
import { inferBehavior, resolveBehavior } from '../agent/agentBehaviorConfig';

import { ChatMessage } from '../../types/chat';
import { ThinkingLevel } from '../llm-client/types';
import { SelectionStyles } from '../../types';
import { emit } from '@create-figma-plugin/utilities';
import { TelemetryService } from './TelemetryService';
import { settingsService } from './SettingsService';

import { initializeSkills, skillRegistry, getActiveAgentTools } from '../agent/skills';
import { AgentLoopPolicy, resolveAgentLoopPolicy } from '../agent/agentLoopPolicy';
import { AgentRuntimeEvent, AgentRuntimePhase } from '../../shared/protocol/agentRuntimeEvents';
import { LLMProvider } from '../llm-client/providers/types';

type RuntimeEventPayload = AgentRuntimeEvent extends infer E
  ? E extends any
    ? Omit<E, 'runId' | 'sequence' | 'timestamp'>
    : never
  : never;

export interface AgentPluginData {
  selectionStyles?: SelectionStyles | null;
  analyzedPattern?: any | null;
  patternSummary?: string;
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
  designSystemId?: string; // Optional: default to 'vanilla'
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
}

import { buildStaticSystemPrompt } from '../llm-client/context/system';
import { getActiveEngineConfig } from '../engineConfig';
import { configManager } from '../../config/configManager';

import { IpcBridge } from '../agent/ipcBridge';
import { buildDynamicContextContent } from '../llm-client/context/dynamicContext';

export class AgentOrchestrator {
  private static initializationPromise: Promise<void> | null = null;
  private activeAgent: AgentRuntime | null = null;
  private currentProvider: LLMProvider | null = null;
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

  async generate(prompt: string, pluginData: AgentPluginData, history: ChatMessage[]) {
    const loopPolicy = resolveAgentLoopPolicy(this.options.loopPolicy);
    // 0. Ensure skills are fully loaded before starting
    await AgentOrchestrator.ensureSkillsInitialized(loopPolicy.useSkillSystem);

    // ── Debug command: /debug prompt ──
    if (prompt.trim().startsWith('/debug')) {
      this.handleDebugCommand(prompt.trim(), pluginData, loopPolicy);
      return;
    }

    // [DI] Instantiate IpcBridge for this session
    const ipcBridge = new IpcBridge({
        logger: console,
        defaultTimeoutMs: 30000
    });

    try {
      // 1. Initialize Agent
      const agent = this.createAgent(pluginData, ipcBridge, prompt, loopPolicy);
      this.activeAgent = agent;

      // 2. Run Agentic Loop
      this.options.onStatusChange?.('Agent starting...');
      try {
        const settings = await settingsService.loadSettings();
        if (settings.telemetryEndpoint) {
          TelemetryService.configure(settings.telemetryEndpoint, settings.telemetryApiKey);
        }
      } catch (telemetryError) {
        console.warn('[AgentOrchestrator] Telemetry setup skipped:', telemetryError);
      }
      
      const startTime = Date.now();
      const finalResponse = await agent.run(prompt);
      const latencyMs = Date.now() - startTime;

      // Log Telemetry (if usage data available from runtime)
      // NOTE: agent.run() returns a string summary. Usage data is tracked
      // per-iteration inside AgentRuntime via TokenRecorder (dev tool).
      // Production telemetry here is a placeholder for future integration.
      const { tokenUsage } = agent.getRunStats();
      TelemetryService.logLLMCall({
        provider: this.options.providerName || 'gemini',
        modelName: this.options.modelName,
        promptTokens: tokenUsage.totalPromptTokens,
        completionTokens: tokenUsage.totalCompletionTokens,
        latencyMs,
        promptText: prompt
      });

      // 3. Finalize
      this.options.onComplete?.({}, finalResponse);

      // 4. Post-run debrief (non-blocking, non-fatal)
      await this.maybeDebrief(agent, 'completed');

    } catch (error: any) {
      console.error('[AgentOrchestrator] Failed:', error);
      if (error instanceof AgentRuntimeCanceledError) {
        this.emitFallbackRuntimeEvent({
          type: 'canceled',
          phase: 'idle',
          reason: error.message || 'Canceled by user',
        });
        return; // Cancel — no debrief
      }

      // Determine exit reason
      const exitReason = error?.message?.includes('Maximum iterations')
        ? 'max_iterations' as const
        : error?.message?.includes('Aborted by hook')
          ? 'abort' as const
          : 'error' as const;

      this.emitFallbackRuntimeEvent({
        type: 'error',
        phase: 'idle',
        message: error?.message || 'Unknown agent error',
      });
      this.options.onError?.(error.message || 'Unknown agent error');

      // Debrief on error (non-fatal)
      if (this.activeAgent) {
        await this.maybeDebrief(this.activeAgent, exitReason);
      }
    } finally {
        // [Cleanup] ALWAYS dispose the bridge to clear listeners and pending timers
        this.activeAgent = null;
        this.currentProvider = null;
        ipcBridge.dispose();
    }
  }

  private emitDebugComplete(summary: string): void {
    this.emitFallbackRuntimeEvent({
      type: 'completed',
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
        designSystemId = 'vanilla',
        tools = agentTools
      } = this.options;
      const providerName = this.options.providerName || 'gemini';

      const hasSelection = !!pluginData.selectionStyles;
      const behaviorConfig = resolveBehavior({
        ...inferBehavior({ hasSelection, userPrompt: '' }),
        thinkingLevel,
        promptPolicy: { useSkillSystem: loopPolicy.useSkillSystem }
      });

      const skillMenu = skillRegistry.getSkillMenu();
      const systemPrompt = buildStaticSystemPrompt(tools, { getToolSystemInstruction: () => '' }, skillMenu);

      // Dump to console
      console.log('\n' + '='.repeat(80));
      console.log('DEBUG: FULL SYSTEM PROMPT');
      console.log('='.repeat(80));
      console.log(`Provider: ${providerName} | Model: ${modelName} | Thinking: ${thinkingLevel}`);
      console.log(`Behavior: strategy=${behaviorConfig.designStrategy}, quality=${behaviorConfig.visualQuality}`);
      console.log(`Skills (menu): ${skillMenu.length}`);
      console.log(`Tools: ${tools.length} (${tools.map(t => t.name).join(', ')})`);
      console.log('-'.repeat(80));
      console.log(systemPrompt);
      console.log('='.repeat(80) + '\n');

      // Also emit the dynamic context
      console.log('DEBUG: DYNAMIC CONTEXT (per-iteration)');
      console.log('-'.repeat(40));
      console.log(buildDynamicContextContent('AUTONOMOUS'));
      console.log('-'.repeat(40) + '\n');

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
        ...inferBehavior({ hasSelection: !!pluginData.selectionStyles, userPrompt: '' }),
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
    prompt?: string,
    loopPolicy?: AgentLoopPolicy
  ): AgentRuntime {
    const { 
      apiKey, 
      modelName, 
      thinkingLevel, 
      designSystemId = 'vanilla',
      tools = agentTools
    } = this.options;

    // Priority: 1. Explicit providerName, 2. Default to Gemini
    // [FIX] Removed heuristic auto-detection that overrode explicit user choice (e.g. modelName having '/')
    let providerName = this.options.providerName || 'gemini';

    // Resolve Engine Config
    const designSystemConfig = getActiveEngineConfig(designSystemId);

    // Initialize Provider
    let provider: LLMProvider;
    if (providerName === 'openrouter') {
      provider = new OpenRouterProvider(apiKey, modelName);
      emit('SEND_LOG', { message: `Using OpenRouter: ${modelName}`, type: 'ai' });
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
    const hasSelection = !!pluginData.selectionStyles;
    const behaviorConfig = resolveBehavior({
      ...inferBehavior({ hasSelection, userPrompt: prompt || '' }),
      thinkingLevel,
      promptPolicy: {
        useSkillSystem: resolvedLoopPolicy.useSkillSystem
      }
    });

    console.log(`[AgentOrchestrator] Behavior resolved: strategy=${behaviorConfig.designStrategy}, quality=${behaviorConfig.visualQuality}, thinking=${behaviorConfig.thinkingLevel}`);

    // Build static system prompt (set once, never changes — enables KV cache)
    const skillMenu = skillRegistry.getSkillMenu();
    const systemPrompt = buildStaticSystemPrompt(tools, provider, skillMenu);

    this.currentProvider = provider;

    return new AgentRuntime({
      provider,
      tools,
      systemPrompt,
      ipcBridge,
      toolExecutors: pluginData.toolExecutors,
      behaviorConfig,
      loopPolicy: resolvedLoopPolicy,
      selectionContext: {
        hasSelection,
        nodes: [],
      },
      onIteration: (iteration: number, response: any, taskInfo?: any) => this.options.onIteration?.(iteration, response, taskInfo),
      onToolCall: this.handleToolCall.bind(this),
      onToolResult: this.handleToolResult.bind(this),
      onIterationStart: (iteration: number, taskInfo?: any) => this.options.onIterationStart?.(iteration, taskInfo),
      onRuntimeEvent: (event) => this.options.onRuntimeEvent?.(event),
    });
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
            const ok = part.functionResponse.response?.success !== false;
            const err = part.functionResponse.response?.error;
            digestLines.push(`  → ${ok ? 'OK' : 'ERR'}${err ? `: ${JSON.stringify(err).slice(0, 100)}` : ''}`);
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
          phase: 'idle' as AgentRuntimePhase,
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
