/**
 * @file llmGenerationCoordinator.ts
 * @description Extracted from agentRuntime.ts — encapsulates the LLM generation
 * lifecycle: streaming setup, retry logic, response normalization, and tool call
 * sanitization. Pure class with injected dependencies, no reference to AgentRuntime.
 */

import { DEFAULT_PROVIDER_CAPABILITIES, LLMProvider, LLMMessage, LLMResponse, ToolCallBlock } from '../llm-client/providers/types';
import { ToolDefinition } from './tools';
import { ToolCallMode } from './agentLoopPolicy';
import { EmptyResponseError, isProviderError, APIError } from '../llm-client/providers/shared/providerErrors';
import { withRetry } from '../llm-client/providers/shared/withRetry';



// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuntimeEventPayload {
  type: string;
  [key: string]: any;
}

export interface LLMGenerationRequest {
  messages: LLMMessage[];
  system?: string;
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
  toolCallsForExecution: ToolCallBlock[];
  /** Raw tool calls before normalization, for loop detection. */
  rawToolCallsForLoopDetection: ToolCallBlock[];
}

export interface LLMGenerationCoordinatorConfig {
  throttleMs: number;
  generateId: (prefix: string) => string;
  normalizeToolCallId: (tc: ToolCallBlock, fallbackPrefix: string) => string;
  emitRuntimeEvent: (event: RuntimeEventPayload) => void;
  throwIfCanceled: (iteration?: number) => void;
  /** Called when the LLM starts producing output (text or thinking). */
  notifyIterationStart?: () => void;
}

// ---------------------------------------------------------------------------
// LLMGenerationCoordinator
// ---------------------------------------------------------------------------

export class LLMGenerationCoordinator {
  /** Retry budget for transient provider failures. Total attempts = 1 + this. */
  private static readonly MAX_RETRIES = 3;
  /** Base exponential-backoff delay (ms). 500 → 1000 → 2000 across retries. */
  private static readonly RETRY_BASE_DELAY_MS = 500;

  private lastThinkingText = '';
  private lastNotificationTime = 0;
  private lastTextNotificationTime = 0;
  private pendingTextDelta = '';

  constructor(
    private provider: LLMProvider,
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
      })),
      messageCount: request.messages.length,
      toolNames: request.tools.map(t => t.name),
      config: {
        maxOutputTokens: request.maxOutputTokens,
        thinkingLevel: request.thinkingLevel,
        toolMode: request.toolConfig.mode,
      },
    });

    try {
      // All transient-failure retry lives in withRetry (exponential backoff,
      // isRetryable decision). A non-retryable error (401, malformed tool
      // call, etc.) surfaces immediately. Exhausted retries re-throw the
      // last error — no silent success fabrication.
      response = await withRetry(
        async () => {
          const res = await this.provider.generate({
            system: request.system,
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

          // Provider returned undefined = contract violation. Normalize into
          // EmptyResponseError so withRetry can treat it uniformly.
          if (!res) {
            throw new EmptyResponseError(this.provider.name, 'Provider returned undefined');
          }

          // Empty response guard: model returned no text AND no tool calls.
          // Raise EmptyResponseError so withRetry decides whether to retry.
          // Mirrors provider.assertNonEmpty() — keeps the decision in ONE place.
          const hasContent = (res.text && res.text.length > 0)
            || (res.toolCalls && res.toolCalls.length > 0);
          if (!hasContent) {
            throw new EmptyResponseError(this.provider.name, 'Response has no text or tool calls');
          }

          return res;
        },
        {
          maxRetries: LLMGenerationCoordinator.MAX_RETRIES,
          baseDelayMs: LLMGenerationCoordinator.RETRY_BASE_DELAY_MS,
          abortSignal: abortController.signal,
          providerName: this.provider.name,
          onRetry: (attempt, err, delayMs) => {
            // Emit a real `retry` event per retry attempt. Previously this site
            // synthesized a failed `llm_response` as a workaround (no dedicated
            // retry event existed), which caused duplicate llm_response pairs
            // per iteration and broke downstream counting. The synthetic event
            // has been removed — the typed `retry` event now carries the
            // signal cleanly (attempt/maxAttempts/delayMs/errorCategory/
            // errorMessage). The successful attempt (if any) emits its own
            // success llm_response below; an exhausted retry surfaces via the
            // catch-block failure llm_response + provider_error.
            this.config.emitRuntimeEvent({
              type: 'retry',
              llmCallId,
              iteration: iteration + 1,
              phase: 'execution',
              attempt,
              maxAttempts: LLMGenerationCoordinator.MAX_RETRIES + 1,
              delayMs,
              errorCategory: isProviderError(err) ? err.category : 'unknown',
              errorMessage: err instanceof Error ? err.message : String(err),
            });
          },
        },
      );

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

      // --- Normalize tool call IDs ---
      const rawToolCalls = response.toolCalls || [];
      const rawToolCallsForLoopDetection = [...rawToolCalls];

      for (const tc of rawToolCalls) {
        tc.id = this.config.normalizeToolCallId(tc, 'call');
      }

      const toolCallsForExecution = rawToolCalls;

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
      // Any error reaching here is either non-retryable or retry-exhausted —
      // withRetry handled the rest. Emit a final failure event and surface.
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.config.emitRuntimeEvent({
        type: 'llm_response',
        llmCallId,
        iteration: iteration + 1,

        phase: 'execution',
        durationMs: Date.now() - llmStartMs,
        usage: undefined,
        responseShape: { textLength: 0, thoughtsLength: 0, toolCallCount: 0, toolCallNames: [] },
        success: false,
        errorMessage,
      });

      // Categorized provider failure event — sibling to llm_response so
      // dashboards can distinguish transport / api / content issues without
      // string-matching errorMessage. Only fired for typed ProviderErrors;
      // generic exceptions (TypeError, etc.) stay covered by llm_response.
      if (isProviderError(err)) {
        this.config.emitRuntimeEvent({
          type: 'provider_error',
          llmCallId,
          iteration: iteration + 1,
          phase: 'execution',
          providerName: err.providerName,
          category: err.category,
          errorClass: err.constructor.name,
          message: err.message,
          userActionable: err.userActionable,
          httpStatus: err instanceof APIError ? err.statusCode : undefined,
        });
      }

      throw err;
    }
  }
}
