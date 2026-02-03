/**
 * @file AgentOrchestrator.ts
 * @description Orchestrator for the Agentic generation flow.
 * Uses AgentRuntime to perform multi-step, tool-using generations.
 */

import { AgentRuntime } from '../agent/agentRuntime';
import { GeminiProvider, OpenRouterProvider } from '../llm-client';
import { agentTools } from '../agent/tools';
import { ToolDefinition, ToolExecutor } from '../agent/tools/types';

import { ChatMessage } from '../../types/chat';
import { ThinkingLevel } from '../llm-client/types';
import { SelectionStyles } from '../../types';
import { emit } from '@create-figma-plugin/utilities';

// Skill-based prompt system
import { initializeSkills, skillRegistry, getActiveAgentTools } from '../agent/skills';
import { composeSkillBasedPrompt, buildSkillContextDeps } from '../agent/skills/skillPromptComposer';

// Feature flag for skill system
const USE_SKILL_SYSTEM = true;

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
  onStatusChange: (status: string) => void;
  onThinkingUpdate: (thought: string) => void;
  onUsageUpdate?: (usage: any) => void;
  onComplete: (data: any, rawText?: string) => void;
  onError: (msg: string) => void;
  onToolCall?: (toolCall: any) => void;
  onToolResult?: (id: string, result: any) => void;
  onIteration?: (iteration: number, response: any, taskInfo?: { taskId: string, taskTitle: string }) => void;
  onIterationStart?: (iteration: number, taskInfo?: { taskId: string, taskTitle: string }) => void;
}

import { composeAgentSystemPrompt, calculateBudget } from '../llm-client/context/promptComposer';
import { getActiveEngineConfig } from '../engineConfig';
import { configManager } from '../../config/configManager';

import { IpcBridge } from '../agent/ipcBridge';

export class AgentOrchestrator {
  private static skillsInitialized = false;

  constructor(private options: OrchestratorOptions) {
    // Initialize skills on first orchestrator creation
    if (USE_SKILL_SYSTEM && !AgentOrchestrator.skillsInitialized) {
      initializeSkills();
      AgentOrchestrator.skillsInitialized = true;
    }
  }

  async generate(prompt: string, pluginData: AgentPluginData, history: ChatMessage[]) {
    // [DI] Instantiate IpcBridge for this session
    const ipcBridge = new IpcBridge({
        logger: console,
        defaultTimeoutMs: 30000 
    });

    try {
      // 1. Initialize Agent
      const agent = this.createAgent(pluginData, ipcBridge);

      // 2. Run Agentic Loop
      this.options.onStatusChange('Agent starting...');
      const finalResponse = await agent.run(prompt);

      // 3. Finalize
      this.options.onComplete({}, finalResponse);

    } catch (error: any) {
      console.error('[AgentOrchestrator] Failed:', error);
      this.options.onError(error.message || 'Unknown agent error');
    } finally {
        // [Cleanup] ALWAYS dispose the bridge to clear listeners and pending timers
        ipcBridge.dispose();
    }
  }

  /**
   * Creates and configures the AgentRuntime with the appropriate provider and tools.
   */
  private createAgent(pluginData: AgentPluginData, ipcBridge: IpcBridge): AgentRuntime {
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
    const totalBudget = calculateBudget({
      totalTokens: 4000 // In the future, this can be derived from provider window
    });

    // Compose System Prompt
    let systemPrompt: string;
    let activeTools: ToolDefinition[];

    if (USE_SKILL_SYSTEM) {
      // Use skill-based prompt composition
      const skillDeps = buildSkillContextDeps('', { designSystemId });
      systemPrompt = composeSkillBasedPrompt(skillDeps, provider, { budget: { total: totalBudget } });
      activeTools = getActiveAgentTools();
      emit('SEND_LOG', { message: `Skills active: ${skillRegistry.getEnabled().map(s => s.id).join(', ')}`, type: 'info' });
    } else {
      // Legacy prompt composition
      systemPrompt = composeAgentSystemPrompt(
        {
          ragResults: { prioritizedComponents: [], goldenTemplates: [] },
          intent: {},
          designSystemContext: { skillName: designSystemConfig.manifest.name }
        },
        tools,
        provider,
        { totalBudget }
      );
      activeTools = tools;
    }

    // Return configured runtime
    return new AgentRuntime({
      provider,
      tools: activeTools,
      systemPrompt,
      ipcBridge, // [DI] Inject Bridge
      toolExecutors: pluginData.toolExecutors, 
      onIteration: (iteration: number, response: any, taskInfo?: any) => this.options.onIteration?.(iteration, response, taskInfo),
      onProgress: this.handleProgress.bind(this),
      onThinking: this.handleThinking.bind(this),
      onToolCall: this.handleToolCall.bind(this),
      onToolResult: this.handleToolResult.bind(this),
      onIterationStart: (iteration: number, taskInfo?: any) => this.options.onIterationStart?.(iteration, taskInfo)
    });
  }

  // ==========================================
  // REUSABLE CALLBACK HANDLERS
  // ==========================================

  private handleIteration(iteration: number, response: any) {
    this.options.onStatusChange(`Thinking (Iteration ${iteration})...`);
    if (response.thoughts) {
      this.options.onThinkingUpdate(response.thoughts);
    }
    if (response.usage) {
      this.options.onUsageUpdate?.(response.usage);
    }
  }

  private handleProgress(chunk: string) {
    console.log(`[Agent] Progress: ${chunk}`);
    // Optional: emit to UI if needed
  }

  private handleThinking(thought: string) {
    this.options.onThinkingUpdate(thought);
  }

  private handleToolCall(tc: any) {
    this.options.onStatusChange(`Executing tool: ${tc.name}...`);
    this.options.onToolCall?.(tc);
  }

  private handleToolResult(tc: any, result: any) {
    console.log(`[Agent] Tool Result (${tc.name}):`, result);
    this.options.onToolResult?.(tc.id, result);
  }
}
