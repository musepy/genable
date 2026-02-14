/**
 * @file agentRuntime.ts
 * @description Core runtime for the agentic loop. Orchestrates LLM calls and tool execution.
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMToolCall, Part } from '../llm-client/providers/types';
import { ToolDefinition, ToolParameter, getToolsForMode, AgentMode } from './tools';
import { IpcBridge } from './ipcBridge';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { RetryPolicy, AgentErrorCategory } from './retryPolicy';
import { planState } from './planState';
import { composeAgentSystemPrompt } from '../llm-client/context/promptComposer';
import { mapToSemanticError, formatSemanticError } from '../utils/errorUtils';
import { AgentBehaviorConfig, DEFAULT_BEHAVIOR, resolveBehavior } from './agentBehaviorConfig';
import { composeSkillBasedPrompt, buildSkillContextDeps } from './skills/skillPromptComposer';
import { estimateTokens } from './context/tokenEstimator';
import { CONTEXT_CONSTANTS } from './context/constants';
import { ToolResultCleaner } from './context/toolResultCleaner';
import { ContextManager } from './context/contextManager';
import {
  AgentLoopPolicy,
  resolveAgentLoopPolicy,
  getToolModeForPhase,
  getMaxTokensForPhase,
} from './agentLoopPolicy';

export interface AgentRuntimeOptions {
  provider: LLMProvider;
  tools: ToolDefinition[];
  ipcBridge?: IpcBridge; // Optional to allow for extensive mocking or local-only modes
  maxIterations?: number;
  maxContextTokens?: number; // Max tokens before context compression
  systemPrompt?: string;
  planId?: string; // Optional ID for persistent planning
  behaviorConfig?: Partial<AgentBehaviorConfig>; // Agent behavior knobs (see agentBehaviorConfig.ts)
  selectionContext?: { hasSelection: boolean; nodes: any[] }; // Current Figma selection
  onIteration?: (iteration: number, response: LLMResponse, taskInfo?: { taskId: string, taskTitle: string }) => void;
  onToolCall?: (toolCall: LLMToolCall) => void;
  onToolResult?: (toolCall: LLMToolCall, result: any) => void;
  onProgress?: (step: string) => void;
  onThinking?: (thought: string) => void;
  onIterationStart?: (iteration: number, taskInfo?: { taskId: string, taskTitle: string }) => void;
  toolExecutors?: Record<string, import('./tools/types').ToolExecutor>;
  designSystemId?: string; // Added for skill-based prompting
  messages?: LLMMessage[]; // Initial messages for the context manager
  loopPolicy?: Partial<AgentLoopPolicy>; // Unified runtime control policy
}

export class AgentRuntime {
  private maxIterations: number;
  private maxContextTokens: number;
  private context: ContextManager;
  private retryPolicy: RetryPolicy;
  private cleaner: ToolResultCleaner;
  private idCounter: number = 0;
  private lastThinkingText: string = '';
  private toolCallSignatureHistory: string[] = [];
  private thinkingOnlyIterations: number = 0;
  private anyModeRetryCount: number = 0;
  private lastNotificationTime: number = 0;
  private readonly THROTTLE_MS = 100;
  private lastProgressSummary: string = '';
  private identicalSummaryCount: number = 0;
  private progressCallCount: number = 0;
  private lastProgressHeaders: string[] = [];
  private hasPendingToolErrors: boolean = false;
  private consecutiveToolFailures: number = 0;
  private collectionAttempts: number = 0; // 🔴 P1: Collection counter
  private staleStepIterations: number = 0; // Track how long a step has been active without advancing
  private lastActiveStepId: string | null = null; // Track which step was active last iteration
  private recoveryActive: boolean = false;
  private recoveryIterations: number = 0;
  private readonly AUTO_BATCH_TOOL_NAMES = new Set([
    'createIcon',
    'deleteNode',
    'applyDesignPatch',
    'renderSubtree',
    'patchNode'
  ]);
  systemPrompt?: string;
  behaviorConfig: AgentBehaviorConfig;
  loopPolicy: AgentLoopPolicy;
  private originalUserRequest: string = '';
  private currentMode: AgentMode = 'PLANNING'; 
  private designSystemId?: string;
  private operationLog: Array<{
    opId?: string;
    action: string;
    reason?: string;
    success: boolean;
    timestamp: number;
    error?: string;
    diffInfo?: string[];
  }> = [];

  constructor(private options: AgentRuntimeOptions) {
    this.retryPolicy = new RetryPolicy();
    this.behaviorConfig = resolveBehavior(options.behaviorConfig);
    this.loopPolicy = resolveAgentLoopPolicy(options.loopPolicy);
    this.maxIterations = options.maxIterations || this.behaviorConfig.maxIterations;
    // FIX: Limit context to prevent MALFORMED_FUNCTION_CALL from excessive prompt size
    this.maxContextTokens = options.maxContextTokens || AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_CONTEXT_TOKENS;
    this.designSystemId = options.designSystemId; // Initialize designSystemId
    this.cleaner = new ToolResultCleaner(options.tools);
    this.context = new ContextManager(this.maxContextTokens, options.messages);

    // Disable throttling in tests
    if (process.env.NODE_ENV === 'test') {
      (this as any).THROTTLE_MS = 0;
    }
  }


  /**
   * Generates a unique ID with prefix, timestamp, random, and counter.
   */
  private generateId(prefix: string): string {
    this.idCounter++;
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 5);
    return `${prefix}_${timestamp}${random}${this.idCounter}`;
  }

  /**
   * Stable short hash for loop-signature fingerprinting.
   */
  private hashString(value: string): string {
    if (!value) return '0';
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private sanitizeOpId(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
  }

  private sanitizeString(value: any, maxLength = 200): string {
    const text = String(value ?? '');
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '…';
  }

  private sanitizeArgsBySchema(value: any, schema?: ToolParameter, depth = 0): any {
    if (value === null || value === undefined || !schema) return value;

    switch (schema.type) {
      case 'string':
        return this.sanitizeString(value);
      case 'number':
      case 'boolean':
        return value;
      case 'array': {
        if (!Array.isArray(value)) return [];
        const sliced = value.slice(0, 20);
        if (!schema.items) return sliced;
        return sliced.map(item => this.sanitizeArgsBySchema(item, schema.items, depth + 1));
      }
      case 'object': {
        if (typeof value !== 'object') return {};
        const props = schema.properties || {};
        const keys = Object.keys(props);
        if (keys.length === 0) {
          const out: Record<string, any> = {};
          const entries = Object.entries(value).slice(0, 10);
          for (const [key, val] of entries) {
            if (val === null || val === undefined) continue;
            if (typeof val === 'string') out[key] = this.sanitizeString(val, 120);
            else if (typeof val === 'number' || typeof val === 'boolean') out[key] = val;
            else if (Array.isArray(val)) out[key] = `[${val.length} items]`;
            else if (typeof val === 'object') out[key] = '{…}';
          }
          return out;
        }

        const out: Record<string, any> = {};
        for (const key of keys) {
          if (value[key] === undefined) continue;
          out[key] = this.sanitizeArgsBySchema(value[key], props[key], depth + 1);
        }
        return out;
      }
      default:
        return value;
    }
  }


  private sanitizeToolCallsForHistory(toolCalls: LLMToolCall[]): LLMToolCall[] {
    return this.cleaner.sanitizeToolCallsForHistory(toolCalls);
  }

  private compactThoughtSignatures(): void {
    let lastToolIdx = -1;
    for (let i = this.context.getAllMessages().length - 1; i >= 0; i--) {
      const msg = this.context.getAllMessages()[i];
      if (msg.hidden || msg.role !== 'tool') continue;
      if (Array.isArray(msg.content) && msg.content.some((p: any) => p.functionResponse)) {
        lastToolIdx = i;
        break;
      }
    }

    const preserve = new Set<number>();
    if (lastToolIdx !== -1) preserve.add(lastToolIdx);

    let mutated = false;
    for (let i = 0; i < this.context.getAllMessages().length; i++) {
      if (preserve.has(i)) continue;
      const msg = this.context.getAllMessages()[i];
      if (msg.hidden) continue;
      if (msg.role !== 'tool') continue;
      if (!Array.isArray(msg.content)) continue;

      let changed = false;
      const cleaned = (msg.content as any[]).map(part => {
        if (!part || typeof part !== 'object') return part;
        const copy = { ...part } as any;
        if ('thought_signature' in copy) {
          delete copy.thought_signature;
          changed = true;
        }
        if ('thoughtSignature' in copy) {
          delete copy.thoughtSignature;
          changed = true;
        }
        return copy;
      });

      if (changed) {
        msg.content = cleaned;
        mutated = true;
      }
    }

    if (mutated) {
      this.context.updateTokens();
      console.log(`[AgentRuntime] 🧽 Compacted thought signatures in tool history. Visible tokens: ${this.context.getApproximateTokens()}`);
    }
  }

  private buildBatchOperationsCall(calls: LLMToolCall[]): LLMToolCall {
    const ops = calls.map((tc, index) => {
      const base =
        tc.args?.name ||
        tc.args?.iconName ||
        tc.args?.nodeId ||
        tc.args?.parentId ||
        tc.name;
      const safeBase = base ? this.sanitizeOpId(String(base)) : '';
      const opId = `${tc.name}_${safeBase || 'op'}_${index + 1}`;
      return {
        opId,
        action: tc.name,
        params: tc.args
      };
    });

    return {
      id: `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: 'batchOperations',
      args: {
        operations: ops,
        strategy: 'sequential',
        onError: 'skip-dependents'
      },
      thought_signature: calls[0]?.thought_signature
    };
  }

  private autoBatchToolCalls(toolCalls: LLMToolCall[], mode: AgentMode): LLMToolCall[] {
    if (mode !== 'EXECUTION') return toolCalls;
    if (!toolCalls || toolCalls.length < 2) return toolCalls;

    const batched: LLMToolCall[] = [];
    let buffer: LLMToolCall[] = [];

    const flush = () => {
      if (buffer.length >= 2) {
        batched.push(this.buildBatchOperationsCall(buffer));
      } else if (buffer.length === 1) {
        batched.push(buffer[0]);
      }
      buffer = [];
    };

    for (const tc of toolCalls) {
      if (this.AUTO_BATCH_TOOL_NAMES.has(tc.name)) {
        buffer.push(tc);
        continue;
      }
      flush();
      batched.push(tc);
    }

    flush();
    return batched;
  }

  /**
   * Delegates context management to ContextManager.
   */
  private async manageContext(): Promise<void> {
    await this.context.manageContext();
  }

  /**
   * Main agent loop
   * 
   * STRUCTURE:
   * 1. Setup Phase: Initialize messages, reset state
   * 2. Iteration Loop:
   *    - Mode Selection (PLANNING/EXECUTION/VERIFICATION)
   *    - System Prompt Reconstruction
   *    - LLM Generate
   *    - Tool Execution
   *    - Loop Detection
   *    - Context Management
   * 3. Termination: complete_task or max iterations
   */
  async run(userPrompt: string): Promise<string> {
    // Store original request for instruction anchoring
    this.originalUserRequest = userPrompt;

    this.context.addMessage({
      id: this.generateId('usr'),
      role: 'user',
      content: userPrompt,
      pinned: this.behaviorConfig.enableInstructionAnchoring, // Survives context compression
    });

    // Reset plan for new request unless explicitly persisting
    if (!this.options.planId) {
      planState.reset();
    }

    // Proactive compression: trigger when usage exceeds threshold
    if (this.context.getApproximateTokens() > this.maxContextTokens * CONTEXT_CONSTANTS.CONTEXT_PROACTIVE_COMPRESSION_FACTOR) {
      await this.manageContext();
    }

    let iteration = 0;
    this.toolCallSignatureHistory = [];
    this.lastThinkingText = '';
    this.thinkingOnlyIterations = 0;
    this.progressCallCount = 0;
    this.staleStepIterations = 0;
    this.lastActiveStepId = null;
    this.recoveryActive = false;
    this.recoveryIterations = 0;
    this.idCounter = 0; // Better to reset idCounter at start of run if not already reset
    this.retryPolicy.resetAll();

    // ============================================
    // ITERATION LOOP
    // ============================================
    while (iteration < this.maxIterations) {
      this.collectionAttempts = 0; // Reset collection counter for each iteration to allow batching
      await this.manageContext();
      // 🟡 P2: compactThoughtSignatures disabled to protect prefix cache
      // this.compactThoughtSignatures(); 
      // Sync approximateTokens to actual visible context after manageContext
      this.context.updateTokens();
      const currentTokens = this.context.getApproximateTokens();
      console.log(`[AgentRuntime] --- Iteration Start: ${iteration}/${this.maxIterations} ---`);
      console.log(`[AgentRuntime] Context Budget: ${currentTokens}/${this.maxContextTokens} tokens (${Math.round(currentTokens/this.maxContextTokens*100)}%)`);
      console.log(`[AgentRuntime] Visible messages: ${this.context.getAllMessages().filter(m => !m.hidden).length}, Hidden: ${this.context.getMessages(true).length}`);

      // Hard stop: if context exceeds 120% of budget after compression, abort to prevent runaway costs
      if (currentTokens > this.maxContextTokens * 1.2) {
        console.error(`[AgentRuntime] FATAL: Context budget exceeded 120% (${currentTokens}/${this.maxContextTokens}) after compression. Aborting to prevent runaway token consumption.`);
        throw new Error(`Agent aborted: context budget exceeded 120% (${Math.round(currentTokens/this.maxContextTokens*100)}%). Context compression failed to reduce token count.`);
      }

      let progressCallsThisIteration = 0;

      // Timing for thinking timeout detection
      const iterationStartTime = Date.now();

      // LAZY LOADING: Don't call onIterationStart yet.
      // We will call it only when we have content to show.
      let hasNotifiedIterationStart = false;
      const notifyIterationStartOnce = () => {
        if (!hasNotifiedIterationStart) {
          const activeTask = planState.getActiveStep();
          const taskInfo = activeTask ? { taskId: activeTask.stepId, taskTitle: activeTask.title } : undefined;
          this.options.onIterationStart?.(iteration, taskInfo);
          hasNotifiedIterationStart = true;
        }
      };

      // ----------------------------------------
      // PHASE 1: MODE DETERMINATION
      // ----------------------------------------
      // 0. Determine Mode based on plan state
      let mode: AgentMode = 'PLANNING';
      let activeStep = planState.getActiveStep();
      const plan = planState.getPlan();

      // [FIX] Auto-activate the next pending step after planDesign.
      // Without an active step, the agent stays in PLANNING and cannot call execution tools.
      if (plan.length > 0 && !activeStep) {
        const nextPending = plan.find(s => s.status === 'pending');
        if (nextPending) {
          planState.startTask(nextPending.title, nextPending.description, nextPending.stepId);
          activeStep = planState.getActiveStep();
        }
      }
      
      if (plan.length > 0) {
        if (activeStep) {
          mode = 'EXECUTION';
        } else if (plan.every(s => s.status === 'completed')) {
          mode = 'VERIFICATION';
        } else {
          // Fallback: if there are pending steps but no active step, still allow execution tools.
          mode = 'EXECUTION';
        }
      }

      // ----------------------------------------
      // STALE STEP DETECTION
      // ----------------------------------------
      // [FIX] Track how long the same step has been active. If a step stays active
      // for too many iterations without completing, force-complete it and advance.
      // This prevents the infinite applyDesignPatch loop where the model keeps
      // "polishing" the same step without ever calling complete_task or summarize_progress.
      if (activeStep) {
        if (activeStep.stepId === this.lastActiveStepId) {
          this.staleStepIterations++;
        } else {
          this.staleStepIterations = 0;
          this.lastActiveStepId = activeStep.stepId;
        }

        if (this.staleStepIterations >= this.loopPolicy.staleStepThreshold) {
          console.warn(`[AgentRuntime] ⚠️ STALE STEP: "${activeStep.title}" (${activeStep.stepId}) has been active for ${this.staleStepIterations} iterations. Force-completing.`);
          planState.completeTask(activeStep.stepId, `Auto-completed after ${this.staleStepIterations} iterations`);
          this.staleStepIterations = 0;
          this.lastActiveStepId = null;

          // Check if there are more steps or if we're done
          const remainingSteps = planState.getPlan().filter(s => s.status === 'pending');
          if (remainingSteps.length === 0) {
            // All steps completed (or force-completed), transition to VERIFICATION
            console.log(`[AgentRuntime] All plan steps completed. Transitioning to VERIFICATION.`);
            mode = 'VERIFICATION';
            // Inject a message to trigger complete_task
            const completionMessage: LLMMessage = {
              id: this.generateId('stale_done'),
              role: 'user',
              content: 'All plan steps have been completed. Call complete_task now with a summary of what was built.'
            };
            this.context.getAllMessages().push(completionMessage);
          } else {
            // Activate next step
            const nextStep = remainingSteps[0];
            planState.startTask(nextStep.title, nextStep.description, nextStep.stepId);
            activeStep = planState.getActiveStep();
            console.log(`[AgentRuntime] Advanced to next step: "${nextStep.title}" (${nextStep.stepId})`);
          }
        }
      }

      // ----------------------------------------
      // RECOVERY MODE OVERRIDE
      // ----------------------------------------
      if (this.loopPolicy.recovery.enabled && mode === 'EXECUTION') {
        const shouldEnterRecovery = this.recoveryActive ||
          this.consecutiveToolFailures >= this.loopPolicy.recovery.entryFailureThreshold;

        if (shouldEnterRecovery) {
          if (!this.recoveryActive) {
            this.recoveryActive = true;
            this.recoveryIterations = 0;
            this.context.addMessage({
              id: this.generateId('recovery_enter'),
              role: 'user',
              content: `RECOVERY MODE: ${this.consecutiveToolFailures} consecutive all-failure iterations detected. Diagnose with inspectDesign/validateLayout first, then resume with a changed strategy.`
            });
            console.warn('[AgentRuntime] Entering RECOVERY mode due to repeated failures.');
          }
          mode = 'RECOVERY';
        }
      }

      this.currentMode = mode; // Update currentMode for prompt composition
      const filteredTools = getToolsForMode(mode, this.options.tools);

      // ----------------------------------------
      // PHASE 2: SYSTEM PROMPT HOT-SWAP
      // ----------------------------------------
      const systemPrompt = await this.composeSystemPrompt();

      // Ensure system prompt is at index 0 and updated
      const existingSysIndices = this.context.getAllMessages()
        .map((m, i) => m.role === 'system' ? i : -1)
        .filter(i => i !== -1);
      
      if (existingSysIndices.length > 0) {
        for (let i = existingSysIndices.length - 1; i >= 0; i--) {
          this.context.getAllMessages().splice(existingSysIndices[i], 1);
        }
      }

      this.context.getAllMessages().unshift({
        id: this.generateId('sys'),
        role: 'system',
        content: systemPrompt
      });
      console.log(`[AgentRuntime] 🔄 System prompt hot-swapped for mode: ${this.currentMode}`);

      // ----------------------------------------
      // PHASE 3: PREPARE LLM CALL
      // ----------------------------------------
      // System prompt is already in context (unshifted above)
      const visibleMessages = this.context.getMessages();
      // LOG VIZUALIZATION (Helpful for debugging loop recovery)
      if (this.thinkingOnlyIterations > 0) {
        console.log(`[AgentRuntime] 🔄 Loop Recovery Active. Context: ${this.context.getMessages().map(m => m.role).join(' -> ')}`);
      }
      
      // LOG FOR DEBUGGING IN TESTS
      if (process.env.NODE_ENV === 'test') {
        // console.log(`[DEBUG] Iteration ${iteration} Mode: ${mode} SysPrompt length: ${systemPrompt.length}`);
      }

      let response: LLMResponse;

      // ----------------------------------------
      // PHASE 4: LLM GENERATION
      // ----------------------------------------
      // Create AbortController for stream timeout
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        console.warn(`[AgentRuntime] Thinking timeout (${AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS}ms) - aborting stream`);
        abortController.abort();
      }, AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS);

      // ----------------------------------------
      // PLAN/ACT TOOL FILTERING
      // ----------------------------------------
      // Filter tools based on current mode to prevent mode mixing
      // filteredTools is already defined above for system prompt construction
      console.log(`[AgentRuntime] Mode: ${mode}, Tools available: ${filteredTools.length}/${this.options.tools.length}`);
      
      // [FIX] Rambling threshold varies by mode:
      // - PLANNING: 4x threshold (plans need more space for analysis)
      // - EXECUTION/VERIFICATION/RECOVERY with ANY mode: NO stream abort (tool calls come AFTER text)
      // - Other modes: default threshold
      const resolvedToolMode = getToolModeForPhase(mode, this.loopPolicy, this.consecutiveToolFailures);
      const isAnyToolMode = resolvedToolMode === 'ANY';
      const ramblingThreshold = mode === 'PLANNING'
        ? AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD * this.loopPolicy.planningRamblingMultiplier
        : isAnyToolMode
          ? Infinity  // [FIX] NEVER abort stream in ANY mode - tool calls arrive LAST
          : AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD;

      const toolConfig = { mode: resolvedToolMode };
      const actionMaxTokens = getMaxTokensForPhase(mode, this.loopPolicy);

      let currentIterationText = '';
      const allowProgressStreaming = mode === 'PLANNING';
      let toolCallsForExecution: LLMToolCall[] = [];
      let rawToolCallsForLoopDetection: LLMToolCall[] = []; // Pre-batch calls for stable fingerprinting
      try {
        response = await this.options.provider.generate({
          messages: this.context.getMessages(),
          tools: filteredTools,  // Use filtered tools based on mode
          toolConfig,
          maxTokens: actionMaxTokens,
          abortSignal: abortController.signal,
          streamTimeoutMs: AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS,
          onProgress: (chunk) => {
            notifyIterationStartOnce();

            // Active Rambling Detection during streaming.
            // EXECUTION mode uses toolConfig.mode='ANY' + reduced maxTokens.
            // ANY guarantees tool calls BUT Gemini streams text BEFORE tool calls.
            // Aborting in EXECUTION mode kills the stream before tool calls arrive.
            // So we only abort in PLANNING mode (not EXECUTION/VERIFICATION with ANY).
            currentIterationText += chunk;
            const accumulatedChars = currentIterationText.length;

            // [FIX] Only abort in modes where toolConfig is AUTO (not ANY).
            // In ANY mode, tool calls are guaranteed but arrive AFTER text in stream.
            if (accumulatedChars > ramblingThreshold) {
                // ramblingThreshold is Infinity for ANY modes, so this only triggers for AUTO modes
                console.warn(`[AgentRuntime] ⚠️ RAMBLING DETECTED: Stream aborted. Length: ${accumulatedChars} chars (Limit: ${ramblingThreshold}, Mode: ${mode})`);
                console.warn(`[AgentRuntime] This is often a sign of a "Thinking Loop" where the model ignores instructions and just updates status.`);

                // Extract progress header if present for de-duplication
                const progressMatch = currentIterationText.match(/Progress: \*\*([^*]+)\*\*/);
                if (progressMatch) {
                    const header = progressMatch[1].trim();
                    this.lastProgressHeaders.push(header);
                    if (this.lastProgressHeaders.length > 5) this.lastProgressHeaders.shift();
                }

                abortController.abort();
            }

            // [INFO] Log progress for ANY mode without aborting
            if (isAnyToolMode && accumulatedChars > AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD) {
                // Log once when threshold would have been hit in non-ANY mode
                if (accumulatedChars <= AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD + 100) {
                    console.log(`[AgentRuntime] 📝 ANY mode: ${accumulatedChars} chars text received, waiting for tool calls...`);
                }
            }

            const now = Date.now();
            if (allowProgressStreaming && now - this.lastNotificationTime >= this.THROTTLE_MS) {
              this.options.onProgress?.(chunk);
              this.lastNotificationTime = now;
            }
          },
          onThinking: (thought) => {
            if (thought && thought !== this.lastThinkingText) {
              notifyIterationStartOnce();
              const now = Date.now();
              if (now - this.lastNotificationTime >= this.THROTTLE_MS) {
                this.options.onThinking?.(thought);
                this.lastNotificationTime = now;
              }
              this.lastThinkingText = thought;
            }
          },
          thinkingLevel: this.behaviorConfig.thinkingLevel
        });

        let rawToolCalls = response.toolCalls || [];

        // Save raw (pre-batch) tool calls for loop detection — these have stable signatures
        // because they don't contain auto-generated opIds from buildBatchOperationsCall.
        rawToolCallsForLoopDetection = [...rawToolCalls];

        // 🔴 P1: Collection-Execution Mode — DISABLED
        // Previously made an extra LLM call when model returned only 1 batchable tool,
        // to "collect" more operations. In practice this doubled latency for minimal gain
        // (typically collecting 0-1 extra operations at the cost of 15-30s per call).
        // The model should be prompted to emit multiple tools in one response instead.
        if (mode === 'EXECUTION' && rawToolCalls.length === 1 &&
            this.AUTO_BATCH_TOOL_NAMES.has(rawToolCalls[0].name)) {
          console.log(`[AgentRuntime] Single batchable tool (${rawToolCalls[0].name}). Executing directly without collection.`);
        }

        const executionToolCalls = rawToolCalls.length > 1
          ? this.autoBatchToolCalls(rawToolCalls, mode)
          : rawToolCalls;

        if (executionToolCalls.length !== rawToolCalls.length) {
          const batchedOps = executionToolCalls.find(tc => tc.name === 'batchOperations')?.args?.operations?.length || 0;
          console.log(`[AgentRuntime] 🔗 Auto-batched ${rawToolCalls.length} tool calls into ${executionToolCalls.length} (batchOps: ${batchedOps})`);
        }

        toolCallsForExecution = executionToolCalls;
        // [FIX] Use executionToolCalls (post-batch) for history — this matches
        // what actually gets executed, preventing model/tool message mismatch.
        const historyToolCalls = this.sanitizeToolCallsForHistory(executionToolCalls);
        response.toolCalls = historyToolCalls;

        // Success: reset transient retry counters
        this.retryPolicy.reset('transient');
        this.retryPolicy.reset('malformed');
      } catch (error: any) {
        const category = this.retryPolicy.classifyError(error);
        const retryKey = category === AgentErrorCategory.RETRYABLE_TRANSIENT ? 'transient' :
                         category === AgentErrorCategory.RETRYABLE_MALFORMED ? 'malformed' : 'input';

        const delay = this.retryPolicy.getNextRetryDelay(category, retryKey);

        if (delay >= 0) {
          console.warn(`[AgentRuntime] ${category} error detected. Retrying after ${delay}ms...`);
          if (error.message) console.warn(`[AgentRuntime] Error message: ${error.message}`);

          // For MALFORMED_FUNCTION_CALL: inject a recovery hint so the model
          // sees different context on retry (otherwise it repeats the same error).
          if (category === AgentErrorCategory.RETRYABLE_MALFORMED) {
            const recoveryHint: LLMMessage = {
              id: this.generateId('mf_hint'),
              role: 'user',
              content: 'Your previous tool call had invalid syntax. Please emit a simpler, single tool call with valid JSON arguments. Use createNode, applyDesignPatch, or batchOperations.'
            };
            this.context.getAllMessages().push(recoveryHint);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
          iteration--; // Retry this iteration
          continue;
        }

        // No more retries or non-retryable error
        throw error;
      } finally {
        // Always clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
      }

      // If we got tools or text, ensure iteration start was notified
      if (response.text || (response.toolCalls && response.toolCalls.length > 0)) {
        notifyIterationStartOnce();
      }

      const activeTask = planState.getActiveStep();
      const taskInfo = activeTask ? { taskId: activeTask.stepId, taskTitle: activeTask.title } : undefined;
      this.options.onIteration?.(iteration, response, taskInfo);

      // Safety check for empty responses
      if (!response.text && (!response.toolCalls || response.toolCalls.length === 0) && !response.thoughts) {
        throw new Error('LLM Provider returned an empty response. This usually indicates a generation failure.');
      }

      // Thinking-only iteration detection: catch "rambling" without action
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const textLength = (response.text || '').length;

        // [FIX] Special case: ANY mode should ALWAYS return tool calls.
        // If it didn't, something went seriously wrong (API bug, stream corruption, etc.)
        // RETRY IMMEDIATELY instead of just counting - don't waste an iteration
        if (isAnyToolMode && textLength > AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD) {
          this.anyModeRetryCount = (this.anyModeRetryCount || 0) + 1;
          console.error(`[AgentRuntime] 🚨 CRITICAL: ANY mode returned NO tool calls! Retry ${this.anyModeRetryCount}/${this.loopPolicy.anyModeNoToolRetryLimit}`);
          console.error(`[AgentRuntime] Response text length: ${textLength}, toolConfig was: ${JSON.stringify(toolConfig)}`);

          if (this.anyModeRetryCount <= this.loopPolicy.anyModeNoToolRetryLimit) {
            // Inject a stronger recovery message and retry this iteration
            const forceToolMessage: LLMMessage = {
              id: this.generateId('force'),
              role: 'user',
              content: `CRITICAL ERROR: You generated ${textLength} characters of text but ZERO tool calls. This violates the ANY mode constraint. You MUST call a tool NOW. Pick ONE: createNode, setNodeLayout, setNodeStyles, updateNodeProperties, or complete_task. Do NOT write any more text - just call the tool.`
            };
            this.context.getAllMessages().push(forceToolMessage);
            console.warn(`[AgentRuntime] 🔄 Retrying iteration ${iteration} with forced tool call message`);
            iteration--; // Retry this iteration
            continue;
          }
          // After 2 retries, fall through to normal handling
          console.error(`[AgentRuntime] ANY mode retry limit reached. Falling back to normal handling.`);
          this.thinkingOnlyIterations += 2; // Severe penalty
        }

        if (textLength > AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD) {
          // Long text without action = likely rambling
          this.thinkingOnlyIterations++;
          console.warn(`[AgentRuntime] ⚠️ THINKING-ONLY ITERATION (${this.thinkingOnlyIterations}/${AGENT_RUNTIME_CONSTANTS.MAX_THINKING_ONLY_ITERATIONS})`);
          console.warn(`[AgentRuntime] Result: Empty tool calls but response length is ${textLength} chars. (Threshold: ${AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD})`);

          if (this.thinkingOnlyIterations >= AGENT_RUNTIME_CONSTANTS.MAX_THINKING_ONLY_ITERATIONS) {
            console.error(`[AgentRuntime] Terminating due to maximum consecutive thinking-only iterations (${AGENT_RUNTIME_CONSTANTS.MAX_THINKING_ONLY_ITERATIONS}).`);
            throw new Error('Agent stuck: multiple iterations with long thinking but no actions. Breaking loop.');
          }
        }
        // Short text = probably final response, let it through
      } else {
        // Has tool calls = making progress, reset counters
        this.thinkingOnlyIterations = 0;
        this.anyModeRetryCount = 0;
      }

      // Add model's response to history
      const modelMessage = this.options.provider.formatResponse(response);
      modelMessage.id = this.generateId('mdl');

      // 🟡 P2: append-only recovery (removed logic that hid model messages)
// This text pollutes context (50K-70K tokens over 14 iterations) and reinforces the narration pattern.
      // By removing text parts, we keep only functional content (tool calls + thoughts) in context.
      if ((mode === 'EXECUTION' || mode === 'VERIFICATION' || mode === 'RECOVERY') && response.toolCalls && response.toolCalls.length > 0) {
        if (Array.isArray(modelMessage.content)) {
          const originalLength = (modelMessage.content as Part[]).length;
          const originalParts = modelMessage.content as Part[];

          // Count text parts before filtering
          const textPartsBefore = originalParts.filter((p: Part) => p.text && !p.thought).length;

          modelMessage.content = originalParts.filter(
            (part: Part) => part.functionCall || part.thought
          );
          const stripped = originalLength - (modelMessage.content as Part[]).length;

          if (stripped > 0) {
            console.log(`[AgentRuntime] 🧹 Stripped ${stripped} narration text parts from ${mode} response. Kept ${(modelMessage.content as Part[]).length} functional parts.`);
          } else if (textPartsBefore > 0) {
            // Debug: text parts existed but weren't stripped - investigate
            console.warn(`[AgentRuntime] ⚠️ Text stripping expected but nothing removed. Original: ${originalLength}, textParts: ${textPartsBefore}`);
          }

          // Check for repetitive progress headers in the stripped text
          const textContent = response.text || '';
          const progressMatch = textContent.match(/Progress: \*\*([^*]+)\*\*/);
          if (progressMatch) {
            const header = progressMatch[1].trim();
            this.lastProgressHeaders.push(header);
            if (this.lastProgressHeaders.length > 5) this.lastProgressHeaders.shift();

            // Detect identical headers in recent history
            const sameHeaderCount = this.lastProgressHeaders.filter(h => h === header).length;
            if (sameHeaderCount >= 3) {
              console.warn(`[AgentRuntime] 🔄 Repeated Progress Header detected: "${header}" (${sameHeaderCount}x). Increasing loop suspicion.`);
              this.thinkingOnlyIterations++; // Treat as a loop signal even if it has tools
            }
          }
        } else {
          // Content is not an array (string) - this shouldn't happen for tool call responses
          console.warn(`[AgentRuntime] ⚠️ modelMessage.content is not an array in EXECUTION mode with tool calls. Type: ${typeof modelMessage.content}`);
        }
      }

      // [Self-Repair] Hide rambling messages to clear the loop anchor from context
      if (this.thinkingOnlyIterations > 0 && (!response.toolCalls || response.toolCalls.length === 0)) {
        console.log(`[AgentRuntime] Hiding rambling turn from future context to break loop anchor.`);
        modelMessage.hidden = true;
      }
      
      this.context.addMessage(modelMessage);
      
      // [DEBUG] Track token growth per message
      const contentJson = typeof modelMessage.content === 'string'
        ? modelMessage.content
        : JSON.stringify(modelMessage.content);
      console.log(`[AgentRuntime] 📊 Model message added. Total visible: ${this.context.getApproximateTokens()} tokens`);

      // ----------------------------------------
      // PHASE 5: TOOL EXECUTION
      // ----------------------------------------
      if (toolCallsForExecution.length > 0) {
        // Handle Workflow Tools Internally
        const workflowResults: import('../llm-client/providers/types').LLMToolResult[] = [];
        const figmaToolCalls: LLMToolCall[] = [];

        for (const tc of toolCallsForExecution) {
          if (tc.name === 'planDesign') {
            const { analysis, steps } = tc.args || {};
            const stepsWithIds = (steps || []).map((step: any, idx: number) => ({
              ...step,
              stepId: step.stepId || `step_${Date.now()}_${idx}`,
              status: 'pending'
            }));

            planState.setCurrentPlan(stepsWithIds);

            console.log('[AgentRuntime] planDesign received:', {
              analysis: analysis?.substring(0, 300) + (analysis?.length > 300 ? '...' : ''),
              stepsCount: stepsWithIds.length
            });

            workflowResults.push({
              name: tc.name,
              id: tc.id,
              response: {
                success: true,
                data: {
                  acknowledged: true,
                  planId: `plan_${Date.now()}`,
                  steps: stepsWithIds.map((s: any) => ({
                    stepId: s.stepId,
                    stepNumber: s.stepNumber,
                    action: s.action,
                    nodes: s.nodes || []
                  })),
                  message: 'Plan received. Each step is a COMPONENT CHUNK — use batchOperations to create ALL nodes listed in each step in ONE call. Do NOT use one tool call per step.'
                }
              },
              thought_signature: tc.thought_signature
            });
          } else if (tc.name === 'new_task') {
            planState.startTask(tc.args.title, tc.args.description, tc.args.stepId);
            workflowResults.push({ name: tc.name, id: tc.id, response: { success: true }, thought_signature: tc.thought_signature });
          } else if (tc.name === 'update_todo_list') {
            planState.updateTodos(tc.args.items);
            workflowResults.push({ name: tc.name, id: tc.id, response: { success: true }, thought_signature: tc.thought_signature });
          } else if (tc.name === 'summarize_progress') {
            if (progressCallsThisIteration >= 1) {
              workflowResults.push({
                name: tc.name,
                id: tc.id,
                response: {
                  success: false,
                  error: {
                    code: 'PROGRESS_THROTTLED',
                    message: 'summarize_progress may be called at most once per iteration.'
                  }
                },
                thought_signature: tc.thought_signature
              });
              continue;
            }

            progressCallsThisIteration++;
            const summary = tc.args.summary;
            this.progressCallCount++;

            if (summary === this.lastProgressSummary) {
              this.identicalSummaryCount++;
            }

            // Two termination conditions: identical 3x, OR total calls exceed threshold+2
            if (this.identicalSummaryCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD ||
                this.progressCallCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD + 2) {
              const reason = this.identicalSummaryCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD
                ? `Repeating same progress summary: "${summary}"`
                : `summarize_progress called ${this.progressCallCount} times without completing task`;
              const semanticError = mapToSemanticError('LOOP_DETECTED', reason);
              workflowResults.push({
                name: tc.name,
                id: tc.id,
                response: { success: false, error: { code: 'LOOP_DETECTION', message: formatSemanticError(semanticError) } },
                thought_signature: tc.thought_signature
              });
              continue;
            }

            if (summary !== this.lastProgressSummary) {
              this.identicalSummaryCount = 0;
            }
            this.lastProgressSummary = summary;

            if (tc.args.isComplete) {
              planState.completeTask(undefined, tc.args.summary);
            }
            workflowResults.push({ name: tc.name, id: tc.id, response: { success: true }, thought_signature: tc.thought_signature });
          } else if (tc.name === 'complete_task') {
            if (this.hasPendingToolErrors) {
              workflowResults.push({
                name: tc.name,
                id: tc.id,
                response: {
                  success: false,
                  error: {
                    code: 'PENDING_TOOL_ERRORS',
                    message: 'Cannot complete task while previous tool calls have errors. Fix the errors first.'
                  }
                },
                thought_signature: tc.thought_signature
              });
            } else {
              // Agent signals completion - return summary and exit
              return tc.args.summary + (tc.args.verification ? `\n\nVerification: ${tc.args.verification}` : '');
            }
          } else {
            figmaToolCalls.push(tc);
          }
        }

        // If we ONLY had workflow tools, and no actual work, we might not want to continue this iteration in UI?
        // But LLM usually calls them along with other tools or precedes them.

        // If we ONLY had workflow tools, and no actual work, we still need to record the results
        const toolResults: import('../llm-client/providers/types').LLMToolResult[] = [...workflowResults];

        // ----------------------------------------
        // PHASE 6: LOOP DETECTION (moved BEFORE figmaToolCalls check)
        // ----------------------------------------
        // [FIX] Use RAW (pre-batch) tool calls for loop detection fingerprinting.
        // Auto-batched calls generate unique opIds (timestamp-based) each iteration,
        // which defeats loop detection by producing different hashes every time.
        // Raw tool calls have stable args from the LLM, enabling proper duplicate detection.
        const allToolCalls = toolCallsForExecution || [];
        const loopDetectionCalls = rawToolCallsForLoopDetection.length > 0
          ? rawToolCallsForLoopDetection
          : allToolCalls;

        // A signature looks at tool name + target context + content fingerprint
        const semanticSignature = loopDetectionCalls.map(tc => {
          const targetNodeId = tc.args?.nodeId;
          const parentId = tc.args?.parentId || tc.args?.parentRef;

          // [Phase 2.5] Declarative Fingerprinting Logic
          // We use longer sampling (64 chars) and context (parentId) to distinguish similar nodes
          let fingerprint = '';
          const nameSample = tc.args?.name ? `|name:${this.sanitizeString(tc.args.name, 64)}` : '';
          const contextSample = parentId ? `|parent:${this.sanitizeString(parentId, 32)}` : '';

          if (tc.name === 'updateNodeProperties' && tc.args?.properties) {
             const propsHash = this.hashString(JSON.stringify(tc.args.properties));
             fingerprint = `|props:${propsHash}`;
          } else if (tc.name === 'setNodeStyles' && (tc.args?.fills || tc.args?.strokes)) {
             const stylesHash = this.hashString(JSON.stringify({ f: tc.args.fills, s: tc.args.strokes }));
             fingerprint = `|style:${stylesHash}`;
          } else if (tc.name === 'createNode') {
            fingerprint = `${nameSample}${contextSample}`;
          } else if (tc.name === 'createIcon' && tc.args?.iconName) {
            fingerprint = `|icon:${tc.args.iconName}${contextSample}`;
          } else if (tc.name === 'applyDesignPatch' && tc.args?.patches?.length > 0) {
            // Group hash of patches to distinguish different patch sets
            const patchHash = this.hashString(JSON.stringify(tc.args.patches.map((p: any) => ({ n: p.nodeId || p.nodeRef, l: !!p.layout, s: !!p.styles }))));
            fingerprint = `|patch:${tc.args.patches.length}|hash:${patchHash}`;
          } else if (tc.name === 'batchOperations' && Array.isArray(tc.args?.operations)) {
            const opIds = tc.args.operations
              .map((op: any) => op?.opId || op?.action)
              .filter(Boolean)
              .join(',');
            fingerprint = `|batch:${tc.args.operations.length}|ops:${this.hashString(opIds)}`;
          } else if (tc.name === 'summarize_progress' && tc.args?.summary) {
            fingerprint = `|sum:${this.hashString(tc.args.summary)}`;
          } else if (tc.name === 'update_todo_list' && tc.args?.items) {
            fingerprint = `|todo:${this.hashString(JSON.stringify(tc.args.items))}`;
          } else if (tc.name === 'new_task' && (tc.args?.title || tc.args?.description)) {
            fingerprint = `|task:${this.hashString(tc.args.title + '|' + tc.args.description)}`;
          } else if (tc.name === 'planDesign' && tc.args?.analysis) {
            fingerprint = `|plan:${this.hashString(tc.args.analysis)}`;
          } else if (tc.name === 'inspectDesign') {
            // [FIX] Include mode and depth to distinguish different inspection calls
            // This prevents false positive loop detection when Agent inspects with different parameters
            const mode = tc.args?.mode || 'selection';
            const depth = tc.args?.depth ?? 5;
            fingerprint = `|mode:${mode}|depth:${depth}`;
          }

          const identifier = targetNodeId || 'new';
          return `${tc.name}[${identifier}${fingerprint}]`;
        }).join('|');

        this.toolCallSignatureHistory.push(semanticSignature);
        if (this.toolCallSignatureHistory.length > 10) this.toolCallSignatureHistory.shift();

        // Semantic Planning Loop Detection: Check for repeated planDesign calls without progress
        // [FIX] Check ALL tool calls, not figmaToolCalls (planDesign is a workflow tool)
        const planCallCount = allToolCalls.filter(tc => tc.name === 'planDesign').length;
        if (planCallCount > 0) {
          const recentPlanCalls = this.toolCallSignatureHistory.filter(sig => sig.includes('planDesign'));
          if (recentPlanCalls.length >= 3) {
            throw new Error(`Agent stuck in planning loop: planDesign called 3+ times consecutively. Try giving more specific instructions.`);
          }
        }

        // Semantic Loop Detection: Check for repeating patterns using signatures
        // [FIX] Moved BEFORE early exit to catch workflow-only loops too
        const identicalSignatureCount = this.toolCallSignatureHistory.filter(sig => sig === semanticSignature).length;
        if (identicalSignatureCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD) {
          throw new Error(
            `[LOOP DETECTED] Same action repeated ${identicalSignatureCount} times: ${semanticSignature}. ` +
            `Consider: (1) Check if previous tool succeeded (2) Try different approach (3) Call complete_task if done.`
          );
        }

        // [FIX] Secondary loop detector: catch "same tool type" repetition even with different args.
        // The model may call applyDesignPatch with slightly different nodeIds/patches each time,
        // producing different signatures but still being stuck in a polish loop.
        // If the last N signatures all contain only the same tool name(s), it's likely a loop.
        const MONOTONE_LOOP_THRESHOLD = this.loopPolicy.monotoneLoopThreshold;
        if (this.toolCallSignatureHistory.length >= MONOTONE_LOOP_THRESHOLD) {
          const recentSignatures = this.toolCallSignatureHistory.slice(-MONOTONE_LOOP_THRESHOLD);
          // Extract the set of tool names from each signature
          const toolNamePatterns = recentSignatures.map(sig => {
            const toolNames = sig.split('|')
              .map(s => s.split('[')[0])
              .filter(Boolean)
              .sort()
              .join('+');
            return toolNames;
          });
          // If all recent iterations use the same tool name pattern
          const allSamePattern = toolNamePatterns.every(p => p === toolNamePatterns[0]);
          if (allSamePattern && toolNamePatterns[0]) {
            // Only trigger for modify-only patterns (not read tools like inspectDesign)
            const isModifyOnly = !toolNamePatterns[0].includes('inspectDesign') &&
                                 !toolNamePatterns[0].includes('planDesign') &&
                                 !toolNamePatterns[0].includes('complete_task');
            if (isModifyOnly) {
              console.warn(`[AgentRuntime] 🔄 MONOTONE LOOP: Same tool pattern "${toolNamePatterns[0]}" for ${MONOTONE_LOOP_THRESHOLD} consecutive iterations. Injecting completion hint.`);
              // Instead of throwing, inject a strong completion hint
              const completionHint: LLMMessage = {
                id: this.generateId('mono_loop'),
                role: 'user',
                content: `⚠️ LOOP DETECTED: You have called "${toolNamePatterns[0]}" for ${MONOTONE_LOOP_THRESHOLD} consecutive iterations. The design is good enough. Call complete_task NOW with a summary. Do NOT make any more style changes.`
              };
              this.context.addMessage(completionHint);
            }
          }
        }

        // Early exit if only workflow tools (no figma tools to execute)
        if (figmaToolCalls.length === 0) {
           if (mode === 'RECOVERY') {
             this.recoveryIterations++;
             this.context.addMessage({
               id: this.generateId('recovery_workflow_only'),
               role: 'user',
               content: `RECOVERY requires at least one diagnostic tool call (${this.loopPolicy.recovery.preferredTools.join(', ')}). Workflow-only calls are insufficient.`
             });

             if (this.recoveryIterations >= this.loopPolicy.recovery.maxIterations) {
               this.recoveryActive = false;
               this.recoveryIterations = 0;
               this.consecutiveToolFailures = 0;
             }
           }

           const workflowResultsMessage = this.options.provider.formatToolResults(workflowResults);
           workflowResultsMessage.id = this.generateId('tol');
           this.context.addMessage(workflowResultsMessage);
           console.log(`[AgentRuntime] 📊 Workflow results added. Total: ${this.context.getApproximateTokens()} tokens`);
           iteration++;
          continue;
        }

        // Group tool calls by strategy for figmaToolCalls
        const groups: { strategy: 'parallel' | 'sequential', calls: LLMToolCall[] }[] = [];
        for (const tc of figmaToolCalls) {
          const toolDef = this.options.tools.find(t => t.name === tc.name);
          const strategy = toolDef?.executionStrategy || 'sequential'; // Default to sequential for safety
          
          if (groups.length > 0 && groups[groups.length - 1].strategy === strategy) {
            groups[groups.length - 1].calls.push(tc);
          } else {
            groups.push({ strategy, calls: [tc] });
          }
        }

        // Track failed nodeIds to skip only dependent operations
        const failedNodeIds = new Set<string>();
        const failureReasons = new Map<string, string>();

        for (const group of groups) {
          if (group.strategy === 'parallel') {
            console.log(`[AgentRuntime] Executing parallel group of ${group.calls.length} tools`);
            const results = await Promise.all(group.calls.map(async (tc) => {
              this.options.onToolCall?.(tc);
              const result = await this.executeToolWithTimeout(tc);
              this.options.onToolResult?.(tc, result);
              return {
                name: tc.name,
                id: tc.id,
                response: this.cleanToolResult(result),
                thought_signature: tc.thought_signature
              };
            }));
            toolResults.push(...results);
          } else {
            console.log(`[AgentRuntime] Executing sequential group of ${group.calls.length} tools`);
            for (const tc of group.calls) {
              this.options.onToolCall?.(tc);
              
              // NEW: Extract nodeId and parentId from tool args for dependency tracking
              const targetNodeId = tc.args?.nodeId || tc.args?.parentId;
              
              let result: any;
              
              // NEW: Only skip if this tool operates on a previously failed nodeId
              if (targetNodeId && failedNodeIds.has(targetNodeId)) {
                const reason = failureReasons.get(targetNodeId) || 'Previous operation failed';
                result = { 
                  success: false, 
                  error: { 
                    code: 'DEPENDENCY_SKIP', 
                    message: `Skipped: node ${targetNodeId} had a previous error: ${reason}` 
                  } 
                };
                console.log(`[AgentRuntime] Skipping ${tc.name} due to dependency on failed node ${targetNodeId}`);
              } else {
                result = await this.executeToolWithTimeout(tc);
                
                // NEW: Track failed nodeIds for smarter skipping
                if (result?.success === false && targetNodeId) {
                  failedNodeIds.add(targetNodeId);
                  failureReasons.set(targetNodeId, result.error?.message || 'Unknown error');
                }
              }

              this.options.onToolResult?.(tc, result);
              const toolResult = this.cleanToolResult(result, tc.name); // Pass tool name

              // NEW: Add semantic feedback to tool results
              if (!toolResult.success && toolResult.error) {
                const semanticError = mapToSemanticError(toolResult.error.code, toolResult.error.message);
                toolResult.error.semanticFeedback = formatSemanticError(semanticError);
              }

              toolResults.push({
                name: tc.name,
                id: tc.id,
                response: toolResult,
                thought_signature: tc.thought_signature
              });
            }
          }
        }

        // [INCREMENTAL] Update Operation Log
        for (const tr of toolResults) {
          const tc = toolCallsForExecution.find(c => c.name === tr.name); // Simple match, enough for log
          const success = tr.response?.success !== false;
          
          if (tr.name === 'batchOperations' && tr.response?.data?.results) {
            // Unpack batch results into the log
            const ops = (tc?.args as any)?.operations || [];
            const results = tr.response.data.results;
            results.forEach((res: any, idx: number) => {
              const op = ops[idx];
              this.operationLog.push({
                opId: res.opId,
                action: res.action,
                reason: op?.reason,
                success: res.success,
                timestamp: Date.now(),
                error: res.error?.message,
                diffInfo: res.diffInfo
              });
            });
          } else {
            this.operationLog.push({
              action: tr.name,
              reason: (tc?.args as any)?.reason,
              success: success,
              timestamp: Date.now(),
              error: tr.response?.error?.message,
              diffInfo: tr.response?.data?.diffInfo
            });
          }
        }
        // Keep last 15 operations
        if (this.operationLog.length > 15) {
          this.operationLog = this.operationLog.slice(-15);
        }

        if (figmaToolCalls.length > 0) {
          const figmaToolNames = new Set(figmaToolCalls.map(tc => tc.name));
          const figmaResults = toolResults.filter(tr => figmaToolNames.has(tr.name));
          const figmaSuccessCount = figmaResults.filter(tr => tr.response?.success !== false).length;
          const figmaFailCount = figmaResults.filter(tr => tr.response?.success === false).length;
          const hadErrors = figmaFailCount > 0;
          this.hasPendingToolErrors = hadErrors;
          const preferredRecoveryToolUsed = figmaToolCalls.some(tc =>
            this.loopPolicy.recovery.preferredTools.includes(tc.name)
          );

          if (mode === 'RECOVERY') {
            this.recoveryIterations++;

            if (preferredRecoveryToolUsed && figmaSuccessCount > 0) {
              this.recoveryActive = false;
              this.recoveryIterations = 0;
              this.consecutiveToolFailures = 0;
              this.context.addMessage({
                id: this.generateId('recovery_exit'),
                role: 'user',
                content: 'Recovery evidence collected successfully. Resume EXECUTION with a different strategy and avoid repeating failed operations.'
              });
              console.log('[AgentRuntime] RECOVERY complete. Resuming normal execution.');
            } else if (!preferredRecoveryToolUsed) {
              this.context.addMessage({
                id: this.generateId('recovery_enforce'),
                role: 'user',
                content: `RECOVERY requires diagnosis tools first. Call one of: ${this.loopPolicy.recovery.preferredTools.join(', ')}.`
              });
            } else if (this.recoveryIterations >= this.loopPolicy.recovery.maxIterations) {
              this.recoveryActive = false;
              this.recoveryIterations = 0;
              this.consecutiveToolFailures = 0;
              this.context.addMessage({
                id: this.generateId('recovery_timeout'),
                role: 'user',
                content: 'Recovery attempts reached the limit. If the current design is acceptable, call complete_task. Otherwise resume EXECUTION with a clearly different approach.'
              });
              console.warn('[AgentRuntime] RECOVERY max iterations reached. Releasing recovery lock.');
            }
          } else {
            // Track consecutive iterations where ALL figma tools failed.
            if (figmaFailCount > 0 && figmaSuccessCount === 0) {
              this.consecutiveToolFailures++;
              console.warn(`[AgentRuntime] ⚠️ All figma tools failed this iteration. Consecutive failures: ${this.consecutiveToolFailures}/${this.loopPolicy.recovery.entryFailureThreshold}`);
            } else if (figmaSuccessCount > 0) {
              this.consecutiveToolFailures = 0;
              this.recoveryActive = false;
              this.recoveryIterations = 0;
            }

            // Escalate to explicit RECOVERY mode instead of repeatedly injecting soft hints.
            if (this.loopPolicy.recovery.enabled &&
                this.consecutiveToolFailures >= this.loopPolicy.recovery.entryFailureThreshold &&
                !this.recoveryActive) {
              this.recoveryActive = true;
              this.recoveryIterations = 0;
              this.context.addMessage({
                id: this.generateId('fail_fb'),
                role: 'user',
                content: `🛑 TOOL FAILURE PATTERN: ${this.consecutiveToolFailures} consecutive iterations where ALL tool calls failed. Next turn is RECOVERY mode. Diagnose with ${this.loopPolicy.recovery.preferredTools.join('/')} before any write actions.`
              });
              console.error('[AgentRuntime] Consecutive failure threshold reached. Scheduled RECOVERY mode.');
            }
          }
        }

        // Add tool results to history using provider-specific formatting
        const toolResultsMessage = this.options.provider.formatToolResults(toolResults);
        toolResultsMessage.id = this.generateId('tol');
        this.context.addMessage(toolResultsMessage);

        // [DEBUG] Track token growth from tool results
        const toolResultsTokens = estimateTokens(toolResultsMessage.content);
        const toolResultsJson = JSON.stringify(toolResultsMessage.content);
        console.log(`[AgentRuntime] 📊 Tool results added: ${toolResultsTokens} tokens (~${toolResultsJson.length} chars). Total: ${this.context.getApproximateTokens()} tokens`);

        // [FIX] Single-tool-call feedback: when model emits only 1 tool in EXECUTION mode,
        // inject a hint to batch more operations next iteration. This is much cheaper than
        // the old "collection" approach (which made a full extra LLM call).
        if (mode === 'EXECUTION' && allToolCalls.length === 1 &&
            allToolCalls[0].name !== 'complete_task' && 
            allToolCalls[0].name !== 'summarize_progress' &&
            allToolCalls[0].name !== 'generateDesign' &&
            allToolCalls[0].name !== 'batchOperations') {
          const batchHint: LLMMessage = {
            id: this.generateId('batch_hint'),
            role: 'user',
            content: `⚠️ You used only 1 tool call this turn. BATCH RULE: use batchOperations to combine 3-5+ operations per call. Create ALL remaining nodes for the current step in ONE batchOperations call.`
          };
          this.context.addMessage(batchHint);
          console.log(`[AgentRuntime] ⚠️ Single-tool hint injected (was: ${allToolCalls[0].name})`);
        }

        // Proactive compression after tool results added
        if (this.context.getApproximateTokens() > this.maxContextTokens * CONTEXT_CONSTANTS.CONTEXT_PROACTIVE_COMPRESSION_FACTOR) {
          await this.manageContext();
        }

        // Continue the loop
        iteration++;
        continue;
      } else {
        // No tool calls - pure text response (final summary or completion)
        // Short text: accept as final response
        // Long text: warn but still accept (don't crash)
        if (this.hasPendingToolErrors) {
          const recoveryMessage: LLMMessage = {
            id: this.generateId('usr'),
            role: 'user',
            content: 'There are unresolved tool errors from the last actions. Fix the errors using tools before completing the task.'
          };
          this.context.addMessage(recoveryMessage);
          console.warn('[AgentRuntime] Blocking text-only completion due to pending tool errors. Retrying with recovery message.');
          iteration--;
          continue;
        }
        if (response.text && response.text.length > 500) {
          console.warn('[AgentRuntime] Long response without tool calls. Consider using complete_task.');
        }
        return response.text;
      }
    }

    throw new Error(`Agent reached maximum iterations (${this.maxIterations})`);
  }

  private async composeSystemPrompt(): Promise<string> {
    const deps: import('../../types/context').PromptDependencies = {
      ragResults: { prioritizedComponents: [], goldenTemplates: [] },
      designSystemContext: { skillName: this.designSystemId || 'default' },
      intent: {
        originalRequest: this.originalUserRequest,
        requiresLayoutKnowledge: true
      },
      selectionContext: this.options.selectionContext,
      behaviorConfig: this.behaviorConfig,
      // [INCREMENTAL] Provide operation log for prompt composition
      operationLog: this.operationLog,
      activeStep: planState.getActiveStep()
    };

    return composeAgentSystemPrompt(
      deps,
      this.options.tools,
      this.options.provider,
      {
        totalBudget: this.maxContextTokens,
        mode: this.currentMode
      }
    );
  }

  private async executeToolWithTimeout(tc: LLMToolCall): Promise<any> {
    const timeout = AGENT_RUNTIME_CONSTANTS.DEFAULT_TOOL_TIMEOUT_MS;
    
    return Promise.race([
      this.executeTool(tc),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Tool execution timed out after ${timeout}ms: ${tc.name}`)), timeout);
      })
    ]).catch(e => {
      console.error(`[AgentRuntime] Tool execution failed: ${tc.name}`, e);
      return { 
        success: false, 
        error: { 
          code: categoryToErrorCode(this.retryPolicy.classifyError(e)), 
          message: e.message 
        } 
      };
    });
  }

  private async executeTool(tc: LLMToolCall): Promise<any> {
    const toolExec = this.options.toolExecutors?.[tc.name];
    
    try {
      if (toolExec) {
        return await toolExec(tc.args);
      } else if (this.options.ipcBridge) {
        return await this.options.ipcBridge.callTool(tc.name, tc.args);
      } else {
        return { success: false, error: { code: 'NO_TOOL_EXECUTOR', message: `No executor found for tool '${tc.name}'` } };
      }
    } catch (e: any) {
      return { 
        success: false, 
        error: { 
          code: 'TOOL_EXEC_EXCEPTION', 
          message: e.message 
        } 
      };
    }
  }

  /**
   * Clean and truncate tool results to prevent context explosion.
   * Tool results with large data payloads can consume excessive tokens.
   */
  private cleanToolResult(result: any, toolName?: string): any {
    return this.cleaner.cleanToolResult({ ...result, ...(toolName && { name: toolName }) });
  }

  public getMessages(): LLMMessage[] {
    return this.context.getAllMessages();
  }
}

/**
 * Convertex agent error category to a tool error code.
 */
function categoryToErrorCode(category: AgentErrorCategory): string {
  switch (category) {
    case AgentErrorCategory.RETRYABLE_TRANSIENT: return 'TOOL_TRANSIENT_ERROR';
    case AgentErrorCategory.RETRYABLE_MALFORMED: return 'TOOL_FORMAT_ERROR';
    case AgentErrorCategory.NON_RETRYABLE_INPUT: return 'TOOL_INVALID_INPUT';
    case AgentErrorCategory.LOCAL_TOOL_ERROR: return 'TOOL_EXECUTION_ERROR';
    default: return 'TOOL_UNKNOWN_ERROR';
  }
}
