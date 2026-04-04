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
  /** Per-message content hashes from the previous LLM call, for cache prefix comparison. */
  private previousMessageHashes: number[] = [];

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
    // NOTE: previousMessageHashes is intentionally NOT reset here.
    // Messages accumulate across runs (this.messages persists), so the
    // hash chain must also persist for accurate KV-cache diagnostics.
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

    let response: LLMResponse;

    this.config.throwIfCanceled(iteration + 1);

    const cache = this.computeCacheDiagnostics(request.messages);
    const llmCallId = this.config.generateId('llm');
    const llmStartMs = Date.now();

    // Emit llm_request before the call
    this.config.emitRuntimeEvent({
      type: 'llm_request',
      llmCallId,
      iteration: iteration + 1,

      phase: 'execution',
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
      cache,
    });

    try {
      response = await retryWithBackoff(
        () => this.provider.generate({
          messages: request.messages,
          tools: request.tools,
          toolConfig: request.toolConfig,
          maxTokens: request.maxOutputTokens,
          abortSignal: abortController.signal,
          onProgress: providerCapabilities.supportsTextStreaming ? (chunk) => {
            this.config.notifyIterationStart?.();
            // Stream text chunks to UI for progressive "grow" effect
            if (chunk) {
              const now = Date.now();
              if (now - this.lastTextNotificationTime >= this.config.throttleMs) {
                // Flush any buffered text BEFORE the current chunk to preserve order
                const text = this.pendingTextDelta + chunk;
                this.pendingTextDelta = '';
                this.config.emitRuntimeEvent({
                  type: 'text_delta',
                  phase: 'execution',

                  iteration: iteration + 1,
                  text,
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
                  phase: 'execution',
            
                  iteration: iteration + 1,
                  maxIterations,
                  message: 'Working...',
                });
                this.config.emitRuntimeEvent({
                  type: 'reasoning_delta',
                  phase: 'execution',
            
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
          maxAttempts: 5,
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
              phase: 'execution',
              iteration: iteration + 1,
              attempt,
              maxAttempts: 5,
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
          phase: 'execution',
    
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

      // Log provider-reported cache hit
      if (response.usage?.cachedTokens) {
        console.log(`[KVCache] Provider reported ${response.usage.cachedTokens} cached tokens out of ${response.usage.promptTokens} prompt tokens`);
      }

      // Emit llm_response (success)
      this.config.emitRuntimeEvent({
        type: 'llm_response',
        llmCallId,
        iteration: iteration + 1,
  
        phase: 'execution',
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
  
        phase: 'execution',
        durationMs: Date.now() - llmStartMs,
        usage: undefined,
        responseShape: { textLength: 0, thoughtsLength: 0, toolCallCount: 0, toolCallNames: [] },
        success: false,
      });
      throw err;
    }
  }

  /**
   * Compare current message sequence with the previous call to find the
   * longest identical prefix — the portion a provider can serve from KV cache.
   */
  private computeCacheDiagnostics(messages: LLMMessage[]): {
    cacheableMessages: number;
    totalMessages: number;
    cacheableTokensEstimate: number;
  } {
    const currentHashes = messages.map(m => {
      const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return this.fnv1a(raw);
    });

    let cacheableMessages = 0;
    let cacheableChars = 0;
    for (let i = 0; i < Math.min(currentHashes.length, this.previousMessageHashes.length); i++) {
      if (currentHashes[i] !== this.previousMessageHashes[i]) break;
      cacheableMessages++;
      const c = messages[i].content;
      cacheableChars += typeof c === 'string' ? c.length : JSON.stringify(c).length;
    }

    this.previousMessageHashes = currentHashes;

    const cacheableTokensEstimate = Math.round(cacheableChars / 4);
    console.log(
      `[KVCache] ${cacheableMessages}/${messages.length} msgs cacheable (~${cacheableTokensEstimate} tokens)`
    );

    return { cacheableMessages, totalMessages: messages.length, cacheableTokensEstimate };
  }

  /** FNV-1a 32-bit hash — small and stable for runtime diagnostics. */
  private fnv1a(value: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash;
  }
}
