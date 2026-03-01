/**
 * @file AgentOrchestrator.ts
 * @description Orchestrator for the Agentic generation flow.
 * Uses AgentRuntime to perform multi-step, tool-using generations.
 */

import { AgentRuntime, AgentRuntimeCanceledError } from '../agent/agentRuntime';
import { GeminiProvider, OpenRouterProvider } from '../llm-client';
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
import { AgentRuntimeEvent } from '../../shared/protocol/agentRuntimeEvents';

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
  providerName?: string; // Optional: default to 'gemini'
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

import { composeAgentSystemPrompt, calculateBudget } from '../llm-client/context/promptComposer';
import { getActiveEngineConfig } from '../engineConfig';
import { configManager } from '../../config/configManager';

import { IpcBridge } from '../agent/ipcBridge';

export class AgentOrchestrator {
  private static initializationPromise: Promise<void> | null = null;
  private activeAgent: AgentRuntime | null = null;
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
      TelemetryService.logLLMCall({
        provider: this.options.providerName || 'gemini',
        modelName: this.options.modelName,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs,
        promptText: prompt
      });

      // 3. Finalize
      this.options.onComplete?.({}, finalResponse);

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
      this.emitFallbackRuntimeEvent({
        type: 'error',
        phase: 'idle',
        message: error?.message || 'Unknown agent error',
      });
      this.options.onError?.(error.message || 'Unknown agent error');
    } finally {
        // [Cleanup] ALWAYS dispose the bridge to clear listeners and pending timers
        this.activeAgent = null;
        ipcBridge.dispose();
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
    let provider: any;
    if (providerName === 'openrouter') {
      provider = new OpenRouterProvider(apiKey, modelName);
      emit('SEND_LOG', { message: `Using OpenRouter: ${modelName}`, type: 'ai' });
    } else {
      // Default to Gemini (existing behavior)
      provider = new GeminiProvider(apiKey, modelName);
      emit('SEND_LOG', { message: `Using Gemini: ${modelName}`, type: 'ai' });
    }

    // Calculate total layout generation budget
    const resolvedLoopPolicy = loopPolicy || resolveAgentLoopPolicy(this.options.loopPolicy);
    const totalBudget = calculateBudget({
      totalTokens: resolvedLoopPolicy.promptBudgetTokens
    });

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

    // Return configured runtime
    // Note: skill system's getActiveAgentTools() resolves to the same agentTools definitions,
    // so we use `tools` directly. Tool filtering by mode happens inside AgentRuntime.
    return new AgentRuntime({
      provider,
      tools,
      // systemPrompt is now lazily composed inside AgentRuntime.run() based on behaviorConfig
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
  // REUSABLE CALLBACK HANDLERS
  // ==========================================

  private handleToolCall(tc: any) {
    this.options.onStatusChange?.(`Executing tool: ${tc.name}...`);
    this.options.onToolCall?.(tc);
  }

  private handleToolResult(tc: any, result: any) {
    console.log(`[Agent] Tool Result (${tc.name}):`, result);
    this.options.onToolResult?.(tc.id, result);
  }
}
