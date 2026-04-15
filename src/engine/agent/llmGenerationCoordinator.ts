/**
 * @file llmGenerationCoordinator.ts
 * @description Extracted from agentRuntime.ts — encapsulates the LLM generation
 * lifecycle: streaming setup, retry logic, response normalization, and tool call
 * sanitization. Pure class with injected dependencies, no reference to AgentRuntime.
 */

import { DEFAULT_PROVIDER_CAPABILITIES, LLMProvider, LLMMessage, LLMResponse, LLMToolCall } from '../llm-client/providers/types';
import { ToolDefinition } from './tools';
import { ToolCallMode } from './agentLoopPolicy';
import { ToolResultCleaner } from './context/toolResultCleaner';
import { EmptyResponseError } from '../llm-client/providers/shared/providerErrors';



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
  private static readonly MAX_EMPTY_RETRIES = 2;

  private lastThinkingText = '';
  private lastNotificationTime = 0;
  private lastTextNotificationTime = 0;
  private pendingTextDelta = '';
  private previousMessageHashes: number[] = [];
  /** Consecutive empty response count for retry logic. */
  private emptyRetryCount = 0;

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
    this.emptyRetryCount = 0;
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
      // Single direct call. Provider layer (fetchWithRetry) is the ONLY retry
      // layer in the system. Any error here is final → throw to AgentRuntime.
      response = await this.provider.generate({
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
      });

      // Provider returned undefined = genuine bug. Provider returned empty content = model issue.
      if (!response) {
        throw new EmptyResponseError(this.provider.name, 'Provider returned undefined');
      }

      // Empty response guard: model returned no text AND no tool calls.
      // Retry up to MAX_EMPTY_RETRIES before returning the empty response
      // to the main loop (which will treat it as a turn end).
      const hasContent = (response.text && response.text.length > 0)
        || (response.toolCalls && response.toolCalls.length > 0);
      if (!hasContent) {
        this.emptyRetryCount++;
        if (this.emptyRetryCount <= LLMGenerationCoordinator.MAX_EMPTY_RETRIES) {
          console.warn(`[LLMCoordinator] Empty response from ${this.provider.name} (retry ${this.emptyRetryCount}/${LLMGenerationCoordinator.MAX_EMPTY_RETRIES})`);
          // Recursive retry — same request, same abort controller
          return this.generate(request, abortController);
        }
        console.warn(`[LLMCoordinator] Empty response persists after ${LLMGenerationCoordinator.MAX_EMPTY_RETRIES} retries — returning to main loop`);
        // Reset for next iteration; let main loop handle the empty response as turn end
        this.emptyRetryCount = 0;
      } else {
        this.emptyRetryCount = 0;
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
      // EmptyResponseError from provider assertNonEmpty: retry here instead of crashing.
      // Provider's assertNonEmpty throws when model returns no text AND no tool calls.
      // We absorb this and retry — empty responses are transient model issues, not bugs.
      if (err instanceof EmptyResponseError) {
        this.emptyRetryCount++;
        if (this.emptyRetryCount <= LLMGenerationCoordinator.MAX_EMPTY_RETRIES) {
          console.warn(`[LLMCoordinator] ${err.message} (retry ${this.emptyRetryCount}/${LLMGenerationCoordinator.MAX_EMPTY_RETRIES})`);
          return this.generate(request, abortController);
        }
        // Exhausted retries — emit failure and re-throw
        this.emptyRetryCount = 0;
      }

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
