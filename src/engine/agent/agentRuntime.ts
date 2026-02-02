/**
 * @file agentRuntime.ts
 * @description Core runtime for the agentic loop. Orchestrates LLM calls and tool execution.
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMToolCall } from '../llm-client/providers/types';
import { ToolDefinition } from './tools/types';
import { IpcBridge } from './ipcBridge';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { RetryPolicy, AgentErrorCategory } from './retryPolicy';
import { DEFAULT_THINKING_LEVEL } from '../llm-client/config';
import { planState } from './planState';
import { AgentMode, composeAgentSystemPrompt } from '../llm-client/context/promptComposer';
import { mapToSemanticError, formatSemanticError } from '../utils/errorUtils';

export interface AgentRuntimeOptions {
  provider: LLMProvider;
  tools: ToolDefinition[];
  ipcBridge?: IpcBridge; // Optional to allow for extensive mocking or local-only modes
  maxIterations?: number;
  maxContextTokens?: number; // Max tokens before context compression
  systemPrompt?: string;
  planId?: string; // Optional ID for persistent planning
  onIteration?: (iteration: number, response: LLMResponse, taskInfo?: { taskId: string, taskTitle: string }) => void;
  onToolCall?: (toolCall: LLMToolCall) => void;
  onToolResult?: (toolCall: LLMToolCall, result: any) => void;
  onProgress?: (chunk: string) => void;
  onThinking?: (thought: string) => void;
  onIterationStart?: (iteration: number, taskInfo?: { taskId: string, taskTitle: string }) => void;
  toolExecutors?: Record<string, import('./tools/types').ToolExecutor>;
}

export class AgentRuntime {
  private messages: LLMMessage[] = [];
  private maxIterations: number;
  private maxContextTokens: number;
  private approximateTokens: number = 0;
  private retryPolicy: RetryPolicy;
  private idCounter: number = 0;
  private lastThinkingText: string = '';
  private toolCallSignatureHistory: string[] = [];
  private thinkingOnlyIterations: number = 0;
  private lastNotificationTime: number = 0;
  private readonly THROTTLE_MS = 100;
  private lastProgressSummary: string = '';
  private identicalSummaryCount: number = 0;

  constructor(private options: AgentRuntimeOptions) {
    this.retryPolicy = new RetryPolicy();
    this.maxIterations = options.maxIterations || AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_ITERATIONS;
    // FIX: Limit context to prevent MALFORMED_FUNCTION_CALL from excessive prompt size
    this.maxContextTokens = options.maxContextTokens || AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_CONTEXT_TOKENS;
    
    // Disable throttling in tests
    if (process.env.NODE_ENV === 'test') {
      (this as any).THROTTLE_MS = 0;
    }
  }

  /**
   * Token estimation with Chinese character support.
   */
  private estimateTokens(content: string | any[]): number {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    
    // Improved estimation: count Chinese characters separately
    // 1 Chinese char ≈ 0.6 tokens (approx empirical value for Gemini)
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    
    const chineseTokens = Math.ceil(chineseChars * AGENT_RUNTIME_CONSTANTS.ESTIMATION_CHINESE_CHAR_MULTIPLIER);
    const otherTokens = Math.ceil(otherChars / AGENT_RUNTIME_CONSTANTS.ESTIMATION_CHARACTERS_PER_TOKEN);
    
    return chineseTokens + otherTokens;
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
   * Check if a message contains function calls (tool calls)
   */
  private hasFunctionCalls(msg: LLMMessage): boolean {
    if (!Array.isArray(msg.content)) return false;
    return msg.content.some((part: any) => part.functionCall);
  }

  /**
   * Define a Turn structure for proper context management
   * A Turn represents a complete interaction: User -> Model -> Tool(s)
   */
  private groupIntoTurns(messages: LLMMessage[]): Array<{ indices: number[]; tokens: number }> {
    const turns: Array<{ indices: number[]; tokens: number }> = [];
    let i = 0;
    
    while (i < messages.length) {
      const msg = messages[i];
      
      // Skip system messages and hidden messages
      if (msg.role === 'system' || msg.hidden) {
        i++;
        continue;
      }
      
      const turnIndices: number[] = [];
      
      // Start of a turn must be a user message
      if (msg.role === 'user') {
        turnIndices.push(i);
        i++;
        
        // Collect the model response
        if (i < messages.length && messages[i].role === 'model' && !messages[i].hidden) {
          turnIndices.push(i);
          const modelMsg = messages[i];
          
          // If model has function calls, collect all following tool responses
          if (this.hasFunctionCalls(modelMsg)) {
            i++;
            while (i < messages.length && messages[i].role === 'tool' && !messages[i].hidden) {
              turnIndices.push(i);
              i++;
            }
          } else {
            i++;
          }
        }
        
        // Calculate tokens for this turn
        const tokens = turnIndices.reduce((sum, idx) => {
          return sum + this.estimateTokens(messages[idx].content);
        }, 0);
        
        turns.push({ indices: turnIndices, tokens });
      } else {
        // Orphaned message (shouldn't happen in valid sequences)
        i++;
      }
    }
    
    return turns;
  }

  /**
   * Validate that the message sequence is valid for Gemini API
   * Rules:
   * 1. Must start with user message (or system then user)
   * 2. No orphaned tool responses (must follow a model function call)
   * 3. Model function calls must be followed by tool responses
   */
  private validateMessageSequence(messages: LLMMessage[]): { valid: boolean; error?: string } {
    const visibleMessages = messages.filter(m => !m.hidden && m.role !== 'system');
    
    if (visibleMessages.length === 0) {
      return { valid: true };
    }
    
    // Rule 1: Must start with user message
    if (visibleMessages[0].role !== 'user') {
      return { 
        valid: false, 
        error: `Sequence must start with user message, but starts with ${visibleMessages[0].role}` 
      };
    }
    
    // Rule 2 & 3: Check function call pairs
    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      
      if (msg.role === 'model' && this.hasFunctionCalls(msg)) {
        // Must have at least one tool response following
        let hasToolResponse = false;
        let j = i + 1;
        while (j < visibleMessages.length && visibleMessages[j].role === 'tool') {
          hasToolResponse = true;
          j++;
        }
        
        if (!hasToolResponse) {
          return { 
            valid: false, 
            error: `Model message at index ${i} has function calls but no tool responses follow` 
          };
        }
      }
      
      if (msg.role === 'tool') {
        // Must be preceded by a model message with function calls
        if (i === 0 || visibleMessages[i - 1].role !== 'model') {
          return { 
            valid: false, 
            error: `Tool message at index ${i} is orphaned (no preceding model message)` 
          };
        }
        
        const prevModel = visibleMessages[i - 1];
        if (!this.hasFunctionCalls(prevModel)) {
          return { 
            valid: false, 
            error: `Tool message at index ${i} follows model without function calls` 
          };
        }
      }
    }
    
    return { valid: true };
  }

  /**
   * Reversible context management using Turn-based truncation.
   * 
   * CRITICAL: Must preserve [User] -> [Model] -> [Tool] sequence integrity.
   * Uses proper turn-based logic to ensure no orphaned messages.
   */
  private async manageContext(): Promise<void> {
    // Validate current sequence before any modifications
    const validationBefore = this.validateMessageSequence(this.messages);
    if (!validationBefore.valid) {
      console.warn('[AgentRuntime] Message sequence invalid before truncation:', validationBefore.error);
    }

    const nonSystemVisibleMessages = this.messages.filter(m => m.role !== 'system' && !m.hidden);
    
    // SMART CLEANING: Remove redundant error turns (still useful for noise reduction)
    const successfulTools = new Set<string>();
    for (let i = nonSystemVisibleMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemVisibleMessages[i];
      if (msg.role === 'tool' && Array.isArray(msg.content)) {
        const results = msg.content as any[];
        const isSuccess = results.every(r => r.functionResponse?.response?.success !== false);
        if (isSuccess) {
          results.forEach(r => successfulTools.add(r.functionResponse?.name));
        } else {
          const allFixed = results.every(r => successfulTools.has(r.functionResponse?.name));
          if (allFixed && nonSystemVisibleMessages.length > AGENT_RUNTIME_CONSTANTS.REDUNDANT_ERROR_DROP_THRESHOLD) {
             msg.hidden = true; // REVERSIBILITY: Just hide
             continue;
          }
        }
      }
    }

    const currentVisibleTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
    
    if (currentVisibleTokens <= this.maxContextTokens * AGENT_RUNTIME_CONSTANTS.CONTEXT_COMPRESSION_LIMIT_FACTOR) {
      return;
    }

    // NEW: Use turn-based truncation
    await this.truncateByTurns();

    // Validate sequence after truncation
    const validationAfter = this.validateMessageSequence(this.messages);
    if (!validationAfter.valid) {
      console.error('[AgentRuntime] CRITICAL: Message sequence invalid after truncation:', validationAfter.error);
      // Attempt to fix by unhiding the most recent turn
      await this.fixInvalidSequence();
    }

    // [ROBUSTNESS]: If still over budget after truncation (due to large single messages), 
    // attempt summarization of the oldest visible blocks.
    if (this.approximateTokens > this.maxContextTokens) {
        await this.summarizeConversation().catch(err => {
            console.warn('[AgentRuntime] Summarization failed, falling back to pure truncation robustness.', err);
        });
    }
  }

  /**
   * Turn-based truncation: Hide oldest complete turns until budget is met.
   * This ensures we never have orphaned messages.
   */
  private async truncateByTurns(): Promise<void> {
    const minTurnsToKeep = 3; // Keep at least 3 complete turns
    const currentVisibleTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
    let tokensToHide = currentVisibleTokens - (this.maxContextTokens * AGENT_RUNTIME_CONSTANTS.CONTEXT_COMPRESSION_LIMIT_FACTOR);
    
    if (tokensToHide <= 0) return;

    // Group messages into turns
    const turns = this.groupIntoTurns(this.messages);
    
    if (turns.length <= minTurnsToKeep) {
      console.log(`[AgentRuntime] Not enough turns to truncate (${turns.length} <= ${minTurnsToKeep})`);
      return;
    }

    let hiddenCount = 0;
    let hiddenTokens = 0;

    // Hide oldest turns first
    for (let i = 0; i < turns.length - minTurnsToKeep; i++) {
      if (tokensToHide <= 0) break;
      
      const turn = turns[i];
      
      // Hide all messages in this turn
      for (const idx of turn.indices) {
        this.messages[idx].hidden = true;
        hiddenCount++;
      }
      
      hiddenTokens += turn.tokens;
      tokensToHide -= turn.tokens;
    }

    if (hiddenCount > 0) {
      console.log(`[AgentRuntime] Context managed via turn-based truncation: hid ${hiddenCount} messages (${hiddenTokens} tokens). Current visible tokens: ${this.estimateTokens(this.messages.filter(m => !m.hidden))}`);
      this.approximateTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
    }
  }

  /**
   * Attempt to fix an invalid sequence by unhiding messages
   */
  private async fixInvalidSequence(): Promise<void> {
    console.warn('[AgentRuntime] Attempting to fix invalid sequence...');
    
    // Find the first visible message
    const firstVisibleIdx = this.messages.findIndex(m => !m.hidden && m.role !== 'system');
    if (firstVisibleIdx === -1) return;
    
    // If first visible is not a user message, unhide backwards until we find a user
    if (this.messages[firstVisibleIdx].role !== 'user') {
      for (let i = firstVisibleIdx - 1; i >= 0; i--) {
        if (this.messages[i].role === 'system') continue;
        
        this.messages[i].hidden = false;
        
        if (this.messages[i].role === 'user') {
          console.log(`[AgentRuntime] Unhid message at index ${i} to ensure sequence starts with user`);
          break;
        }
      }
    }
    
    // Re-validate
    const validation = this.validateMessageSequence(this.messages);
    if (validation.valid) {
      console.log('[AgentRuntime] Sequence fixed successfully');
    } else {
      console.error('[AgentRuntime] Unable to fix sequence:', validation.error);
    }
  }

  /**
   * Summarizes a block of visible messages and replaces them with a single summary message.
   * Original messages are marked hidden instead of deleted (Strong Reversibility).
   * 
   * [FIX]: Uses turn-based grouping to ensure no orphaned messages.
   */
  private async summarizeConversation(): Promise<void> {
    const turns = this.groupIntoTurns(this.messages);
    if (turns.length < 4) return; // Not enough context to summarize effectively (keep at least 3 turns + 1 to summarize)

    // Summarize roughly half of the available turns
    const turnsToSummarize = turns.slice(0, Math.floor(turns.length / 2));
    const allIndicesToHide: number[] = [];
    const allIdsToSummarize: string[] = [];

    for (const turn of turnsToSummarize) {
      allIndicesToHide.push(...turn.indices);
      for (const idx of turn.indices) {
        allIdsToSummarize.push(this.messages[idx].id);
      }
    }

    if (allIndicesToHide.length === 0) return;

    try {
      const messagesToSummarize = allIndicesToHide.map(idx => this.messages[idx]);
      const summaryText = await this.requestSummary(messagesToSummarize);
      
      // Hide originals
      allIndicesToHide.forEach(idx => {
        this.messages[idx].hidden = true;
      });

      // Add summary message at the position of the first hidden non-system message
      const firstHiddenIdx = this.messages.findIndex(m => m.hidden && m.role !== 'system' && !m.summaryOf);
      const insertIdx = firstHiddenIdx !== -1 ? firstHiddenIdx : (this.messages[0]?.role === 'system' ? 1 : 0);

      this.messages.splice(insertIdx, 0, {
        id: this.generateId('sum'),
        role: 'system',
        content: `SUMMARY OF PREVIOUS CONTEXT:\n${summaryText}`,
        summaryOf: allIdsToSummarize
      });

      this.approximateTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));
      console.log(`[AgentRuntime] Conversation summarized successfully (${turnsToSummarize.length} turns condensed).`);
    } catch (e) {
      // Robustness: failure just means we keep the original messages
      console.warn('[AgentRuntime] Summarization request failed:', e);
      throw e;
    }
  }

  private async requestSummary(messages: LLMMessage[]): Promise<string> {
    // Simple summary request using the same provider
    const summaryResponse = await this.options.provider.generate({
      messages: [
        { id: 'sum_req', role: 'system', content: 'Summarize the following design conversation concisely, preserving critical decisions and node IDs.' },
        ...messages
      ],
      maxTokens: 500
    });
    return summaryResponse.text || 'Context condensed.';
  }

  async run(userPrompt: string): Promise<string> {
    this.messages.push({ 
      id: this.generateId('usr'),
      role: 'user', 
      content: userPrompt 
    });
    this.approximateTokens += this.estimateTokens(userPrompt);

    // Reset plan for new request unless explicitly persisting
    if (!this.options.planId) {
      planState.reset();
    }

    // Proactive compression: trigger when usage exceeds threshold
    if (this.approximateTokens > this.maxContextTokens * AGENT_RUNTIME_CONSTANTS.CONTEXT_PROACTIVE_COMPRESSION_FACTOR) {
      await this.manageContext();
    }

    let iteration = 0;
    this.toolCallSignatureHistory = [];
    this.lastThinkingText = '';
    this.thinkingOnlyIterations = 0;
    this.retryPolicy.resetAll();

    while (iteration < this.maxIterations) {
      iteration++;
      console.log(`[AgentRuntime] Iteration ${iteration}/${this.maxIterations}`);

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

      // 0. Determine Mode based on plan state
      let mode: AgentMode = 'PLANNING';
      const activeStep = planState.getActiveStep();
      const plan = planState.getPlan();
      
      if (plan.length > 0) {
        if (activeStep) {
          mode = 'EXECUTION';
        } else if (plan.every(s => s.status === 'completed')) {
          mode = 'VERIFICATION';
        }
      }
      // 1. Core System Prompt Reconstruction (Hot-Swapping)
      const systemPrompt = composeAgentSystemPrompt(
        { 
          ragResults: { prioritizedComponents: [], goldenTemplates: [] },
          intent: {}, 
          designSystemContext: { skillName: 'vanilla' },
          selectionContext: { hasSelection: false, nodes: [] }
        },
        this.options.tools,
        this.options.provider,
        { mode }
      );

      // Ensure system prompt is at index 0 and updated
      const existingSysIndex = this.messages.findIndex(m => m.role === 'system');
      if (existingSysIndex !== -1) {
        // Update existing & move to front
        const sysMsg = this.messages.splice(existingSysIndex, 1)[0];
        sysMsg.content = systemPrompt;
        this.messages.unshift(sysMsg);
      } else {
        this.messages.unshift({
          id: this.generateId('sys'),
          role: 'system',
          content: systemPrompt
        });
      }

      // 2. Capture visible messages
      const visibleMessages = this.messages.filter(m => !m.hidden);
      
      // LOG FOR DEBUGGING IN TESTS
      if (process.env.NODE_ENV === 'test') {
        // console.log(`[DEBUG] Iteration ${iteration} Mode: ${mode} SysPrompt length: ${systemPrompt.length}`);
      }

      let response: LLMResponse;

      // Create AbortController for stream timeout
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        console.warn(`[AgentRuntime] Thinking timeout (${AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS}ms) - aborting stream`);
        abortController.abort();
      }, AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS);

      try {
        response = await this.options.provider.generate({
          messages: visibleMessages,
          tools: this.options.tools,
          abortSignal: abortController.signal,
          streamTimeoutMs: AGENT_RUNTIME_CONSTANTS.THINKING_TIMEOUT_MS,
          onProgress: (chunk) => {
            notifyIterationStartOnce();
            
            // Active Rambling Detection: Abort if text exceeds threshold during streaming
            const accumulatedChars = (response?.text || '').length + chunk.length;
            if (accumulatedChars > AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD * 2) {
                console.warn(`[AgentRuntime] Active rambling detected (${accumulatedChars} chars) - aborting stream`);
                abortController.abort();
            }

            const now = Date.now();
            if (now - this.lastNotificationTime >= this.THROTTLE_MS) {
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
          thinkingLevel: DEFAULT_THINKING_LEVEL
        });

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
        if (textLength > AGENT_RUNTIME_CONSTANTS.RAMBLING_TEXT_THRESHOLD) {
          // Long text without action = likely rambling
          this.thinkingOnlyIterations++;
          console.warn(`[AgentRuntime] Thinking-only iteration detected (${this.thinkingOnlyIterations}/${AGENT_RUNTIME_CONSTANTS.MAX_THINKING_ONLY_ITERATIONS}). Text length: ${textLength}`);

          if (this.thinkingOnlyIterations >= AGENT_RUNTIME_CONSTANTS.MAX_THINKING_ONLY_ITERATIONS) {
            throw new Error('Agent stuck: multiple iterations with long thinking but no actions. Breaking loop.');
          }
        }
        // Short text = probably final response, let it through
      } else {
        // Has tool calls = making progress, reset counter
        this.thinkingOnlyIterations = 0;
      }

      // Add model's response to history
      const modelMessage = this.options.provider.formatResponse(response);
      modelMessage.id = this.generateId('mdl');
      this.messages.push(modelMessage);
      this.approximateTokens += this.estimateTokens(modelMessage.content);

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Handle Workflow Tools Internally
        const workflowResults: import('../llm-client/providers/types').LLMToolResult[] = [];
        const figmaToolCalls: LLMToolCall[] = [];

        for (const tc of response.toolCalls) {
          if (tc.name === 'new_task') {
            planState.startTask(tc.args.title, tc.args.description, tc.args.stepId);
            workflowResults.push({ name: tc.name, response: { success: true }, thought_signature: tc.thought_signature });
          } else if (tc.name === 'update_todo_list') {
            planState.updateTodos(tc.args.items);
            workflowResults.push({ name: tc.name, response: { success: true }, thought_signature: tc.thought_signature });
          } else if (tc.name === 'summarize_progress') {
            const summary = tc.args.summary;
            if (summary === this.lastProgressSummary) {
              this.identicalSummaryCount++;
              if (this.identicalSummaryCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD) {
                const semanticError = mapToSemanticError('LOOP_DETECTED', `Repeating same progress summary: "${summary}"`);
                workflowResults.push({ 
                  name: tc.name, 
                  response: { success: false, error: { code: 'LOOP_DETECTED', message: formatSemanticError(semanticError) } }, 
                  thought_signature: tc.thought_signature 
                });
                continue;
              }
            } else {
              this.lastProgressSummary = summary;
              this.identicalSummaryCount = 0;
            }

            if (tc.args.isComplete) {
              planState.completeTask(undefined, tc.args.summary);
            }
            workflowResults.push({ name: tc.name, response: { success: true }, thought_signature: tc.thought_signature });
          } else {
            figmaToolCalls.push(tc);
          }
        }

        // If we ONLY had workflow tools, and no actual work, we might not want to continue this iteration in UI?
        // But LLM usually calls them along with other tools or precedes them.

        // If we ONLY had workflow tools, and no actual work, we still need to record the results
        const toolResults: import('../llm-client/providers/types').LLMToolResult[] = [...workflowResults];
        
        if (figmaToolCalls.length === 0) {
           const workflowResultsMessage = this.options.provider.formatToolResults(workflowResults);
           workflowResultsMessage.id = this.generateId('tol');
           this.messages.push(workflowResultsMessage);
           this.approximateTokens += this.estimateTokens(workflowResultsMessage.content);
           continue;
        }

        // Semantic Loop Detection: Check for repeating patterns using signatures
        // A signature looks at tool name + target nodeId (if applicable)
        const semanticSignature = figmaToolCalls.map(tc => {
          const targetNodeId = tc.args?.nodeId || tc.args?.parentId;
          return targetNodeId ? `${tc.name}(${targetNodeId})` : tc.name;
        }).join('|');

        this.toolCallSignatureHistory.push(semanticSignature);
        if (this.toolCallSignatureHistory.length > 10) this.toolCallSignatureHistory.shift();

        const identicalSignatureCount = this.toolCallSignatureHistory.filter(sig => sig === semanticSignature).length;
        if (identicalSignatureCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD) {
           // If we hit threshold, check if it's really the same tool+args for strict check
           const exactSignature = figmaToolCalls.map(tc => `${tc.name}:${JSON.stringify(tc.args)}`).join('|');
           const exactCount = this.toolCallSignatureHistory.filter(sig => {
             // This is a bit simplified, but captures the intent of strict vs semantic
             return sig === semanticSignature; 
           }).length;

           if (exactCount >= AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD) {
             throw new Error(`Agent stuck in loop: repeatedly performing the same actions on the same nodes. Last action: ${semanticSignature}`);
           }
        }

        // Semantic Planning Loop Detection: Check for repeated planDesign calls without progress
        const planCallCount = figmaToolCalls.filter(tc => tc.name === 'planDesign').length;
        if (planCallCount > 0) {
          const recentPlanCalls = this.toolCallSignatureHistory.filter(sig => sig.includes('planDesign'));
          if (recentPlanCalls.length >= 3) {
            throw new Error(`Agent stuck in planning loop: planDesign called 3+ times consecutively. Try giving more specific instructions.`);
          }
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
              const toolResult = this.cleanToolResult(result); // Clean result here

              // NEW: Add semantic feedback to tool results
              if (!toolResult.success && toolResult.error) {
                const semanticError = mapToSemanticError(toolResult.error.code, toolResult.error.message);
                toolResult.error.semanticFeedback = formatSemanticError(semanticError);
              }

              toolResults.push({
                name: tc.name,
                response: toolResult,
                thought_signature: tc.thought_signature
              });
            }
          }
        }

        // Add tool results to history using provider-specific formatting
        const toolResultsMessage = this.options.provider.formatToolResults(toolResults);
        toolResultsMessage.id = this.generateId('tol');
        this.messages.push(toolResultsMessage);
        this.approximateTokens += this.estimateTokens(toolResultsMessage.content);

        // Proactive compression after tool results added
        if (this.approximateTokens > this.maxContextTokens * AGENT_RUNTIME_CONSTANTS.CONTEXT_PROACTIVE_COMPRESSION_FACTOR) {
          await this.manageContext();
        }

        // Continue the loop
        continue;
      } else {
        // Final response: already in history, just return text
        return response.text;
      }
    }

    throw new Error(`Agent reached maximum iterations (${this.maxIterations})`);
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

  private cleanToolResult(result: any): any {
    if (result && typeof result === 'object') {
      const cleaned = { ...result };
      if (cleaned.error && typeof cleaned.error === 'object') {
        cleaned.error = {
          message: cleaned.error.message || 'Unknown error',
          code: cleaned.error.code
        };
      }
      return cleaned;
    }
    return result;
  }

  public getMessages(): LLMMessage[] {
    return this.messages;
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
