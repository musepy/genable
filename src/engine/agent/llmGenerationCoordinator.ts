/**
 * @file llmGenerationCoordinator.ts
 * @description Extracted from agentRuntime.ts — encapsulates the LLM generation
 * lifecycle: streaming setup, retry logic, response normalization, and tool call
 * sanitization. Pure class with injected dependencies, no reference to AgentRuntime.
 */

import { DEFAULT_PROVIDER_CAPABILITIES, LLMProvider, LLMMessage, LLMResponse, LLMToolCall } from '../llm-client/providers/types';
import { ToolDefinition } from './tools';
import { ToolCallMode } from './agentLoopPolicy';
import { classifyError, isRetryableError, AgentErrorCategory } from './retryPolicy';
import { retryWithBackoff } from './retry';
import { ToolResultCleaner } from './context/toolResultCleaner';
import { AGENT_RUNTIME_CONSTANTS } from './constants';
import type { AgentRuntimePhase } from '../../shared/protocol/agentRuntimeEvents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuntimeEventPayload {
  type: string;
  [key: string]: any;
}

export interface LLMGenerationRequest {
  messages: LLMMessage[];
  tools: ToolDefinition[];
  toolConfig: { mode: ToolCallMode };
  maxOutputTokens: number;
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high';
  iteration: number;
  maxIterations: number;
}

export interface LLMGenerationResult {
  /** The raw LLM response with toolCalls replaced by sanitized versions for history. */
  response: LLMResponse;
  /** Original tool calls with normalized IDs, for execution. */
  toolCallsForExecution: LLMToolCall[];
  /** Raw tool calls before normalization, for loop detection. */
  rawToolCallsForLoopDetection: LLMToolCall[];
}

export interface LLMGenerationCoordinatorConfig {
  ramblingThreshold: number;
  thinkingTimeoutMs: number;
  throttleMs: number;
  generateId: (prefix: string) => string;
  normalizeToolCallId: (tc: LLMToolCall, fallbackPrefix: string) => string;
  emitRuntimeEvent: (event: RuntimeEventPayload) => void;
  throwIfCanceled: (iteration?: number) => void;
  /** Called when the LLM starts producing output (text or thinking). */
  notifyIterationStart?: () => void;
}

// ---------------------------------------------------------------------------
// LLMGenerationCoordinator
// ---------------------------------------------------------------------------

export class LLMGenerationCoordinator {
  /** Tracks the last thinking text for deduplication. */
  private lastThinkingText = '';
  /** Throttle timestamp for reasoning delta events. */
  private lastNotificationTime = 0;

  constructor(
    private provider: LLMProvider,
    private cleaner: ToolResultCleaner,
    public config: LLMGenerationCoordinatorConfig,
  ) {}

  /**
   * Reset per-run state. Call at the start of each agent run.
   */
  public reset(): void {
    this.lastThinkingText = '';
    this.lastNotificationTime = 0;
  }

  /**
   * Execute a single LLM generation with streaming, retry, and response normalization.
   */
  public async generate(
    request: LLMGenerationRequest,
    abortController: AbortController,
  ): Promise<LLMGenerationResult> {
    const { iteration, maxIterations } = request;
    const providerCapabilities = this.provider.getCapabilities?.() || DEFAULT_PROVIDER_CAPABILITIES;

    let currentIterationText = '';
    let response: LLMResponse;

    this.config.throwIfCanceled(iteration + 1);

    response = await retryWithBackoff(
      () => this.provider.generate({
        messages: request.messages,
        tools: request.tools,
        toolConfig: request.toolConfig,
        maxTokens: request.maxOutputTokens,
        abortSignal: abortController.signal,
        streamTimeoutMs: this.config.thinkingTimeoutMs,
        onProgress: providerCapabilities.supportsTextStreaming ? (chunk) => {
          this.config.notifyIterationStart?.();
          currentIterationText += chunk;
          if (currentIterationText.length > this.config.ramblingThreshold) {
            console.warn(`[LLMGenCoordinator] RAMBLING DETECTED: ${currentIterationText.length} chars. Aborting stream.`);
            abortController.abort();
          }
        } : undefined,
        onThinking: providerCapabilities.supportsReasoningStreaming ? (thought) => {
          if (thought && thought !== this.lastThinkingText) {
            this.config.notifyIterationStart?.();
            const now = Date.now();
            if (now - this.lastNotificationTime >= this.config.throttleMs) {
              this.config.emitRuntimeEvent({
                type: 'status',
                phase: 'execution' as AgentRuntimePhase,
                mode: 'AUTONOMOUS',
                iteration: iteration + 1,
                maxIterations,
                message: 'Working...',
              });
              this.config.emitRuntimeEvent({
                type: 'reasoning_delta',
                phase: 'execution' as AgentRuntimePhase,
                mode: 'AUTONOMOUS',
                iteration: iteration + 1,
                text: thought,
              });
              this.lastNotificationTime = now;
            }
            this.lastThinkingText = thought;
          }
        } : undefined,
        thinkingLevel: request.thinkingLevel,
      }),
      {
        maxAttempts: 4,
        initialDelayMs: 2000,
        maxDelayMs: 15000,
        jitterFactor: 0.3,
        backoffMultiplier: 2,
        shouldRetry: (err) => isRetryableError(err),
        signal: abortController.signal,
        onBeforeRetry: (attempt, err) => {
          const category = classifyError(err);
          if (category === AgentErrorCategory.RETRYABLE_MALFORMED) {
            // Inject a malformed-hint message into the context so the LLM self-corrects.
            request.messages.push({
              id: this.config.generateId('mf_hint'),
              role: 'user',
              content: 'Your previous tool call had invalid syntax. Please emit a simpler, single tool call with valid JSON arguments.',
            });
          }
        },
        onRetry: (attempt, err, delayMs) => {
          const category = classifyError(err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.warn(`[LLMGenCoordinator] ${category} error (attempt ${attempt}). Retrying after ${delayMs}ms...`);
          this.config.emitRuntimeEvent({
            type: 'retry',
            phase: 'execution' as AgentRuntimePhase,
            iteration: iteration + 1,
            attempt,
            maxAttempts: 4,
            delayMs,
            errorCategory: category,
            errorMessage,
          });
        },
      },
    );

    if (!response) {
      response = { text: '', toolCalls: [] };
    }

    // --- Normalize & sanitize tool calls ---
    const rawToolCalls = response.toolCalls || [];
    const rawToolCallsForLoopDetection = [...rawToolCalls];

    for (const tc of rawToolCalls) {
      tc.id = this.config.normalizeToolCallId(tc, 'call');
    }

    const toolCallsForExecution = rawToolCalls;
    const historyToolCalls = this.cleaner.sanitizeToolCallsForHistory(rawToolCalls);
    response.toolCalls = historyToolCalls;

    return {
      response,
      toolCallsForExecution,
      rawToolCallsForLoopDetection,
    };
  }
}
