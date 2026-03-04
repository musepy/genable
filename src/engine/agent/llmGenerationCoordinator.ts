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
  /** Throttle timestamp for text delta events. */
  private lastTextNotificationTime = 0;
  /** Buffered text delta not yet emitted due to throttling. */
  private pendingTextDelta = '';
  /** Previous stable-prefix hash for cache diagnostics. */
  private lastStablePrefixHash: string | null = null;

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
    this.lastTextNotificationTime = 0;
    this.pendingTextDelta = '';
    this.lastStablePrefixHash = null;
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
    this.logPrefixHashDiagnostics(request.messages, iteration);

    const llmCallId = this.config.generateId('llm');
    const llmStartMs = Date.now();

    // Emit llm_request before the call
    this.config.emitRuntimeEvent({
      type: 'llm_request',
      llmCallId,
      iteration: iteration + 1,
      mode: 'AUTONOMOUS',
      phase: 'execution' as AgentRuntimePhase,
      messages: request.messages.map(m => ({
        id: m.id,
        role: m.role,
        contentLength: typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length,
        hidden: m.hidden,
        pinned: m.pinned,
      })),
      messageCount: request.messages.filter(m => !m.hidden).length,
      toolNames: request.tools.map(t => t.name),
      config: {
        maxOutputTokens: request.maxOutputTokens,
        thinkingLevel: request.thinkingLevel,
        toolMode: request.toolConfig.mode,
      },
    });

    try {
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
            // Stream text chunks to UI for progressive "grow" effect
            if (chunk) {
              const now = Date.now();
              if (now - this.lastTextNotificationTime >= this.config.throttleMs) {
                this.config.emitRuntimeEvent({
                  type: 'text_delta',
                  phase: 'execution' as AgentRuntimePhase,
                  mode: 'AUTONOMOUS',
                  iteration: iteration + 1,
                  text: chunk,
                });
                this.lastTextNotificationTime = now;
              } else {
                this.pendingTextDelta += chunk;
              }
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

      // Flush any buffered text delta
      if (this.pendingTextDelta) {
        this.config.emitRuntimeEvent({
          type: 'text_delta',
          phase: 'execution' as AgentRuntimePhase,
          mode: 'AUTONOMOUS',
          iteration: iteration + 1,
          text: this.pendingTextDelta,
        });
        this.pendingTextDelta = '';
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

      // Emit llm_response (success)
      this.config.emitRuntimeEvent({
        type: 'llm_response',
        llmCallId,
        iteration: iteration + 1,
        mode: 'AUTONOMOUS',
        phase: 'execution' as AgentRuntimePhase,
        durationMs: Date.now() - llmStartMs,
        usage: response.usage,
        responseShape: {
          textLength: response.text?.length || 0,
          thoughtsLength: response.thoughts?.length || 0,
          toolCallCount: toolCallsForExecution.length,
          toolCallNames: toolCallsForExecution.map(tc => tc.name),
        },
        success: true,
      });

      return {
        response,
        toolCallsForExecution,
        rawToolCallsForLoopDetection,
      };
    } catch (err) {
      // Emit llm_response (failure) before re-throwing
      this.config.emitRuntimeEvent({
        type: 'llm_response',
        llmCallId,
        iteration: iteration + 1,
        mode: 'AUTONOMOUS',
        phase: 'execution' as AgentRuntimePhase,
        durationMs: Date.now() - llmStartMs,
        usage: undefined,
        responseShape: { textLength: 0, thoughtsLength: 0, toolCallCount: 0, toolCallNames: [] },
        success: false,
      });
      throw err;
    }
  }

  private logPrefixHashDiagnostics(messages: LLMMessage[], iteration: number): void {
    const systemMessages = messages.filter(m => m.role === 'system');
    const firstUserMessage = messages.find(m => m.role === 'user');

    const stablePrefixMessages = firstUserMessage
      ? [...systemMessages, firstUserMessage]
      : [...systemMessages];

    const stablePrefixSignature = stablePrefixMessages
      .map(m => `${m.role}:${this.normalizeContent(m.content)}`)
      .join('\n---\n');

    const systemSignature = systemMessages
      .map(m => this.normalizeContent(m.content))
      .join('\n---\n');

    const firstUserSignature = firstUserMessage
      ? this.normalizeContent(firstUserMessage.content)
      : '';

    const stablePrefixHash = this.hashString(stablePrefixSignature);
    const systemHash = this.hashString(systemSignature);
    const firstUserHash = this.hashString(firstUserSignature);
    const sameAsPrevious = this.lastStablePrefixHash === stablePrefixHash;
    this.lastStablePrefixHash = stablePrefixHash;

    const headRoles = messages.slice(0, 6).map(m => m.role).join('>');
    console.log(
      `[LLMGenCoordinator] PrefixHash iter=${iteration} prefix_stable=${sameAsPrevious} stable_hash=${stablePrefixHash} system_hash=${systemHash} first_user_hash=${firstUserHash} systems=${systemMessages.length} messages=${messages.length} headRoles=${headRoles}`
    );
  }

  private normalizeContent(content: LLMMessage['content']): string {
    if (typeof content === 'string') return content;
    try {
      return JSON.stringify(content);
    } catch {
      return '[unserializable-content]';
    }
  }

  private hashString(value: string): string {
    // FNV-1a 32-bit: small and stable enough for runtime diagnostics.
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(36);
  }
}
