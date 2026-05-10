/**
 * @file openai-protocol.ts
 * @description Generic OpenAI-compatible protocol provider. Replaces per-vendor
 * providers (OpenRouter, DashScope-OpenAI, …) with a single handler keyed off
 * ProviderConfig.protocol === 'openai'. Vendor differences (auth headers,
 * User-Agent, Referer/Title) come from `config.headers`, not subclasses.
 *
 * Absorbed: openrouter.ts (auth + extra headers + non-streaming) +
 * dashscope.ts (streaming SSE, incremental tool-call accumulation, Kimi
 * temperature default, null-args guard, connect timeout).
 *
 * Dropped: Worker proxy / fetchProxy / workerUrl, vision regex auto-detection,
 * hardcoded OpenRouter Referer/Title, hardcoded DashScope User-Agent,
 * throw-on-unknown-model maxOutput.
 */

import type { ProviderConfig } from '../../../types/provider';
import {
  LLMProvider,
  LLMGenerateOptions,
  LLMResponse,
  LLMMessage,
  LLMToolResult,
  LLMProviderCapabilities,
  ToolCallBlock,
  formatResponseDefault,
  formatToolResultsDefault,
  getToolSystemInstructionDefault,
} from './types';
import type { ToolDefinition } from '../../agent/tools/types';
import { ResponseAccumulator } from './shared/responseAccumulator';
import { consumeStream, withConnectTimeout } from './shared/streamHandler';
import { mapMessagesToOpenAI, mapOpenAIToLLMResponse } from './shared/openaiFormat';
import { getModelQuirks, learnModelQuirk, isImageRejection400 } from './shared/modelQuirks';
import { normalizeFinishReason } from './types';
import { withRetry } from './shared/withRetry';
import {
  ConnectTimeoutError,
  TransportError,
  APIError,
  EmptyResponseError,
} from './shared/providerErrors';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connect timeout: max time until first byte. Inherited from dashscope.ts ~L42-45
 * because cross-border TTFB (Cloudflare edge → China datacenter) can be 10-30s+
 * plus model reasoning time. The value is conservative for non-China endpoints
 * but harmless — it is a TTFB guard, not a retry policy.
 */
const CONNECT_TIMEOUT_MS = 90_000;

/** Retry budget — single source of truth for openai-protocol attempts. */
const RETRY_MAX = 2;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Default cap when the user-supplied modelId is not in our hint registry.
 * Intentionally conservative — under-requesting is cheaper than a 400 from
 * the upstream provider. Old per-vendor registries threw on unknown models;
 * that is hostile to the new "any provider" world.
 */
const DEFAULT_MAX_OUTPUT = 16_384;

/**
 * Hint registry combining DashScope's documented + probed values
 * (dashscope.ts L75-87) with a handful of common OpenAI / OpenRouter ids.
 * Unknown ids fall back to DEFAULT_MAX_OUTPUT with a warn — never throw.
 */
const KNOWN_MAX_OUTPUT: Record<string, number> = {
  // DashScope native ids (from old dashscope.ts DASHSCOPE_MAX_OUTPUT) ─────────
  'qwen3.6-plus': 65_536,
  'qwen3.5-plus': 65_536,
  'qwen3-max-2026-01-23': 32_768,
  'qwen3-coder-plus': 65_536,
  'qwen3-coder-next': 65_536,
  'glm-5': 65_536,
  'glm-4.7': 131_072,
  'kimi-k2.5': 98_304,
  'kimi-k2.6': 98_304,
  'kimi-k2-0905-preview': 98_304,
  'MiniMax-M2.5': 32_768,
  // Common OpenAI / DeepSeek ids ─────────────────────────────────────────────
  'gpt-4o': 16_384,
  'gpt-4o-mini': 16_384,
  'gpt-5': 32_768,
  'deepseek-chat': 8_192,
  'deepseek-reasoner': 32_768,
  // OpenRouter "vendor/model" ids — a few common picks; OpenRouter's dynamic
  // /models endpoint covered the long tail in the old provider, but we keep
  // a small whitelist so frequent picks resolve without a network round-trip.
  'anthropic/claude-3.5-sonnet': 8_192,
  'anthropic/claude-sonnet-4.5': 64_000,
  'openai/gpt-4o': 16_384,
  'openai/gpt-5': 32_768,
  'google/gemini-2.5-pro': 65_536,
};

/** Resolve max output for a model — registry hint, else default. Never throws. */
function resolveMaxOutput(modelId: string, requested?: number): number {
  const cap = KNOWN_MAX_OUTPUT[modelId];
  if (cap == null) {
    console.warn(
      `[openai-protocol] Model "${modelId}" not in KNOWN_MAX_OUTPUT registry; ` +
        `falling back to ${DEFAULT_MAX_OUTPUT}. Add an entry if the upstream cap is higher.`,
    );
    const fallback = DEFAULT_MAX_OUTPUT;
    return requested != null ? Math.min(requested, fallback) : fallback;
  }
  return requested != null ? Math.min(requested, cap) : cap;
}

function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(7);
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export class OpenAIProtocolProvider implements LLMProvider {
  public readonly name = 'openai-protocol';

  constructor(private readonly config: ProviderConfig) {
    if (!config.modelId) {
      throw new Error('[openai-protocol] ProviderConfig.modelId is required');
    }
  }

  getCapabilities(): LLMProviderCapabilities {
    // Most OpenAI-compatible models are vision-capable. Specific exceptions
    // — DeepSeek's image_url rejection, Xiaomi mimo-v2.5-pro's missing
    // multimodal route — live in shared/modelQuirks.ts. Default stays open.
    const q = getModelQuirks(this.config.modelId);
    return {
      supportsTextStreaming: true,
      supportsReasoningStreaming: true,
      supportsVision: q.supportsVision ?? true,
      contextWindow: 1_000_000,
    };
  }

  // ── LLMProvider surface ────────────────────────────────────────────────────

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const useStream = !!(options.onProgress || options.onThinking);

    const dispatch = (body: Record<string, any>) =>
      useStream
        ? this.runStreaming(body, options.onProgress, options.onThinking, options.abortSignal)
        : this.runSync(body, options.abortSignal);

    try {
      return await withRetry(() => dispatch(this.buildRequestBody(options)), {
        maxRetries: RETRY_MAX,
        baseDelayMs: RETRY_BASE_DELAY_MS,
        abortSignal: options.abortSignal,
        providerName: this.name,
      });
    } catch (err) {
      // Last-resort safety net: if the vendor returned a stereotyped image-
      // rejection 400 (DeepSeek's `unknown variant image_url` or Xiaomi's
      // `No endpoints found that support image input`), the model is
      // image-incapable but not yet in MODEL_QUIRKS. Learn the quirk for the
      // rest of the session and retry once with images stripped. Anything
      // else (network 5xx, auth 401, real model errors) bubbles unchanged.
      if (
        err instanceof APIError &&
        err.statusCode === 400 &&
        isImageRejection400(err.message) &&
        this.getCapabilities().supportsVision &&
        this.config.modelId
      ) {
        console.warn(
          `[openai-protocol] Image-rejection 400 from "${this.config.modelId}". ` +
          `Learning supportsVision=false for this session and retrying without images.`,
        );
        learnModelQuirk(this.config.modelId, { supportsVision: false });
        // buildRequestBody() now sees supportsVision=false → strips images
        return await dispatch(this.buildRequestBody(options));
      }
      throw err;
    }
  }

  async *generateStream(options: LLMGenerateOptions): AsyncIterable<LLMResponse> {
    // Same shape the old DashScope provider exposed: aggregate then yield once.
    // The streaming progress is delivered via onProgress/onThinking callbacks.
    yield await this.generate(options);
  }

  formatResponse(response: LLMResponse): LLMMessage {
    return formatResponseDefault(response);
  }

  formatToolResults(results: LLMToolResult[]): LLMMessage {
    return formatToolResultsDefault(results);
  }

  getToolSystemInstruction(tools: ToolDefinition[]): string {
    return getToolSystemInstructionDefault(tools);
  }

  // ── Request building ───────────────────────────────────────────────────────

  private buildRequestBody(options: LLMGenerateOptions): Record<string, any> {
    const { messages, tools, temperature, maxTokens, responseSchema, toolConfig } = options;

    // Kimi K2.5 quirk preserved from dashscope.ts L236-240:
    // temperature < 1.0 causes empty `tool_calls` (finish_reason=tool_calls but
    // args=null). Official guidance is 1.0; 0.7 is a balance between
    // determinism and avoiding the bug. Other models keep the lower default.
    const isKimiModel = /kimi/i.test(this.config.modelId!);
    const defaultTemp = isKimiModel ? 0.7 : 0.4;

    // Strip image content for models that reject image_url at the API/router
    // layer (deepseek-v4-*, mimo-v2.5-pro). Tool-list filtering (Wave 2) already
    // prevents image-producing tools from being callable; this catches the
    // remaining vector — user-pasted images and any future image source.
    const stripImages = !this.getCapabilities().supportsVision;
    const openAIMessages = mapMessagesToOpenAI(messages, { stripImages });
    if (options.system) {
      openAIMessages.unshift({ role: 'system', content: options.system });
    }

    const body: Record<string, any> = {
      model: this.config.modelId,
      messages: openAIMessages,
      temperature: temperature ?? defaultTemp,
      max_tokens: resolveMaxOutput(this.config.modelId!, maxTokens),
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      const mode = toolConfig?.mode || 'AUTO';
      if (mode === 'ANY') body.tool_choice = 'required';
      else if (mode === 'NONE') body.tool_choice = 'none';
      else body.tool_choice = 'auto';
    }

    // Kimi K2.x via OpenCode Go enables thinking by default. When thinking
    // is active, subsequent requests must include `reasoning_content` on
    // assistant messages that contain tool_calls — even if the first turn
    // didn't produce any reasoning. An empty string satisfies the requirement
    // and prevents "thinking is enabled but reasoning_content is missing" 400s.
    if (isKimiModel) {
      for (const msg of openAIMessages) {
        if (msg.role === 'assistant' && msg.tool_calls && !('reasoning_content' in msg)) {
          msg.reasoning_content = msg.reasoning_content || '';
        }
      }
    }

    if (responseSchema && !tools) {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }

  /**
   * Build request headers. Order matters: vendor headers spread BEFORE we
   * reapply Authorization/Content-Type so the auth pair always wins, even if
   * a malformed preset tries to override it.
   */
  private headers(streaming: boolean): Record<string, string> {
    const merged: Record<string, string> = {
      ...(this.config.headers || {}),
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (streaming) merged['Accept'] = 'text/event-stream';
    return merged;
  }

  private endpoint(): string {
    return `${this.config.baseURL}/chat/completions`;
  }

  // ── Sync (non-streaming) ───────────────────────────────────────────────────

  private async runSync(body: Record<string, any>, abortSignal?: AbortSignal): Promise<LLMResponse> {
    let res: Response;
    try {
      res = await withConnectTimeout(
        () =>
          fetch(this.endpoint(), {
            method: 'POST',
            headers: this.headers(false),
            body: JSON.stringify(body),
            signal: abortSignal,
          }),
        CONNECT_TIMEOUT_MS,
      );
    } catch (e: any) {
      throw this.toTransportError(e);
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new APIError(this.name, res.status, errText);
    }

    const data = await res.json();
    const mapped = mapOpenAIToLLMResponse(data) as LLMResponse;
    const cleaned = this.dropNullArgsToolCalls(mapped);
    return this.assertNonEmpty(cleaned.response, cleaned.discarded);
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  private async runStreaming(
    body: Record<string, any>,
    onProgress?: (chunk: string) => void,
    onThinking?: (thought: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<LLMResponse> {
    const streamingBody = { ...body, stream: true };

    let res: Response;
    try {
      res = await withConnectTimeout(
        () =>
          fetch(this.endpoint(), {
            method: 'POST',
            headers: this.headers(true),
            body: JSON.stringify(streamingBody),
            signal: abortSignal,
          }),
        CONNECT_TIMEOUT_MS,
      );
    } catch (e: any) {
      throw this.toTransportError(e);
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new APIError(this.name, res.status, errText);
    }

    const reader = res.body!.getReader();
    const accumulator = new ResponseAccumulator();
    // Tool calls arrive as incremental deltas (index + partial args). Accumulate
    // by index across chunks before emitting. Logic ported verbatim from
    // dashscope.ts L370-509 — many bug fixes baked in over time.
    const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

    // Accumulate reasoning_content in a side buffer so we can include it
    // in the assistant message for subsequent turns (kimi-k2.6 thinks this
    // is required when thinking is enabled for tool-call turns).
    let reasoningFromStream = '';

    try {
      await consumeStream(
        this.parseSSEStream(reader),
        (parsed: any) => {
          const chunk = this.mapStreamChunk(parsed, toolCallAccumulator);
          if (chunk.text) onProgress?.(chunk.text);
          if (chunk.thoughts) {
            onThinking?.(chunk.thoughts);
            reasoningFromStream += chunk.thoughts;
          }
          accumulator.append(chunk);
        },
        { abortSignal },
      );
    } finally {
      reader.cancel().catch(() => {});
    }

    const finalResponse = accumulator.finalize();
    // If stream had reasoning_content that wasn't captured as thoughts in
    // the response (some providers emit it but the accumulator only tracks
    // text/toolCalls), hoist it into the response.
    if (reasoningFromStream && !finalResponse.thoughts) {
      finalResponse.thoughts = reasoningFromStream;
    }

    // Inject the accumulated tool calls (they were never emitted per-chunk).
    if (
      toolCallAccumulator.size > 0 &&
      (!finalResponse.toolCalls || finalResponse.toolCalls.length === 0)
    ) {
      const toolCalls: ToolCallBlock[] = [];
      for (const [, tc] of toolCallAccumulator) {
        let parsedArgs: any;
        try {
          parsedArgs = JSON.parse(tc.args);
        } catch {
          parsedArgs = tc.args;
        }
        toolCalls.push({ type: 'tool_call' as const, id: tc.id, name: tc.name, input: parsedArgs });
      }
      finalResponse.toolCalls = toolCalls.length > 0 ? toolCalls : undefined;
    }

    const cleaned = this.dropNullArgsToolCalls(finalResponse);
    return this.assertNonEmpty(cleaned.response, cleaned.discarded);
  }

  /**
   * SSE byte stream → parsed JSON objects. OpenAI-spec: each event is
   * `data: {…json}\n\n`, terminator is `data: [DONE]`.
   */
  private async *parseSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): AsyncGenerator<any> {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data);
        } catch {
          /* partial line, fall through */
        }
      }
    }
  }

  /**
   * Maps a single SSE chunk (OpenAI streaming delta format) to LLMResponse.
   * Tool calls are accumulated in `toolCallAcc` because OpenAI streams them
   * incrementally (first chunk: index + function.name; later chunks:
   * function.arguments fragments). Logic ported from dashscope.ts L480-524.
   */
  private mapStreamChunk(
    data: any,
    toolCallAcc: Map<number, { id: string; name: string; args: string }>,
  ): LLMResponse {
    const choice = data.choices?.[0];
    const delta = choice?.delta;

    let text = '';
    let thoughts = '';

    if (delta?.content) text = delta.content;
    // Some providers (e.g. Kimi K2.x) emit `reasoning_content` for chain-of-thought.
    // Also check `reasoning` field (some providers use this alternative name).
    if (delta?.reasoning_content) thoughts = delta.reasoning_content;
    if (delta?.reasoning) thoughts = delta.reasoning;

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCallAcc.get(idx);
        if (!existing) {
          toolCallAcc.set(idx, {
            id: tc.id || randomId('call_'),
            name: tc.function?.name || '',
            args: tc.function?.arguments || '',
          });
        } else {
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.args += tc.function.arguments;
        }
      }
    }

    return {
      text,
      thoughts: thoughts || undefined,
      // Tool calls only emitted in finalize — they accumulate across chunks.
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
            cachedTokens: data.usage.prompt_tokens_details?.cached_tokens || undefined,
          }
        : undefined,
      finishReason: normalizeFinishReason(choice?.finish_reason),
    };
  }

  // ── Post-processing guards ─────────────────────────────────────────────────

  /**
   * Filter out tool calls whose `input` is null / non-object. Preserved from
   * dashscope.ts L405-417 + L447-459.
   *
   * Why: Kimi K2.5 (and occasionally other Qwen-family models) emit
   * finish_reason=tool_calls with no actual arguments — a complete frame with
   * an empty payload. Empty object `{}` is a valid zero-arg call (e.g.
   * list_variables()) and MUST pass through; only null / non-object is dropped.
   */
  private dropNullArgsToolCalls(
    response: LLMResponse,
  ): { response: LLMResponse; discarded: string[] } {
    const discarded: string[] = [];
    if (!response.toolCalls) return { response, discarded };

    const kept = response.toolCalls.filter((tc) => {
      const hasInput = tc.input != null && typeof tc.input === 'object';
      if (!hasInput) {
        console.warn(`[openai-protocol] Discarding null-args tool call: ${tc.name}`);
        discarded.push(tc.name);
      }
      return hasInput;
    });

    return {
      response: { ...response, toolCalls: kept.length > 0 ? kept : undefined },
      discarded,
    };
  }

  /** Final empty-response gate. Throws EmptyResponseError when no content survived. */
  private assertNonEmpty(response: LLMResponse, discarded: string[]): LLMResponse {
    const hasText = !!response.text && response.text.length > 0;
    const hasToolCalls = !!response.toolCalls && response.toolCalls.length > 0;
    if (!hasText && !hasToolCalls) {
      const detail =
        discarded.length > 0
          ? `Empty after discarding ${discarded.length} null-args tool call(s): ${discarded.join(', ')}`
          : 'Provider returned no text, thoughts, or tool calls';
      throw new EmptyResponseError(this.name, detail);
    }
    return response;
  }

  /** Normalize raw fetch failures into typed ProviderError. */
  private toTransportError(e: any): TransportError | ConnectTimeoutError {
    if (e?.name === 'AbortError') return new TransportError(this.name, 'Aborted', e);
    if (typeof e?.message === 'string' && e.message.includes('Connection timed out')) {
      return new ConnectTimeoutError(this.name, CONNECT_TIMEOUT_MS);
    }
    if (e instanceof Error) return new TransportError(this.name, e.message, e);
    return new TransportError(this.name, String(e));
  }
}
