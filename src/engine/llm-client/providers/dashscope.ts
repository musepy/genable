/**
 * @file dashscope.ts
 * @description DashScope provider — supports both sync (fetchProxy) and streaming (workerUrl SSE).
 *
 * Sync path: fetchProxy → Worker /api/dashscope/generate-sync → DashScope API
 * Streaming path: fetch → Worker /api/dashscope/generate (SSE) → DashScope API (stream=true)
 *
 * Reuses the same OpenAI message/tool mapping as OpenRouterProvider.
 * Streaming reuses shared ResponseAccumulator + consumeStream + withConnectTimeout.
 */

import {
  LLMProvider,
  LLMGenerateOptions,
  LLMResponse,
  LLMMessage,
  LLMToolCall,
  LLMToolResult,
  LLMProviderCapabilities,
  formatResponseDefault,
  formatToolResultsDefault,
  getToolSystemInstructionDefault,
} from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { DASHSCOPE_CONFIG } from '../config';
import { ResponseAccumulator } from './shared/responseAccumulator';
import { consumeStream, withConnectTimeout } from './shared/streamHandler';
import { mapMessagesToOpenAI, mapOpenAIToLLMResponse } from './shared/openaiFormat';
import { normalizeFinishReason } from './types';
import {
  StreamIdleTimeoutError,
  ConnectTimeoutError,
  TransportError,
  APIError,
  EmptyResponseError,
} from './shared/providerErrors';

export type FetchProxy = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; body: string }>;

/** Idle timeout: max silence between chunks (ms). Extra hop through Worker. */
const STREAM_IDLE_TIMEOUT_MS = 45000;
/** Connect timeout: max time until first byte from Worker proxy (ms).
 * DashScope TTFB through Worker can be 10-30s+ due to cross-border latency
 * (Cloudflare edge → China datacenter) plus model reasoning time. */
const CONNECT_TIMEOUT_MS = 90000;
/** Max retries for transient 5xx errors (e.g. Cloudflare 520). */
const MAX_RETRIES = 2;
/** Base delay for exponential backoff (ms): 2s → 4s. */
const RETRY_BASE_DELAY_MS = 2000;

function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(7);
}

export class DashScopeProvider implements LLMProvider {
  public readonly name = 'dashscope';

  constructor(
    private readonly apiKey: string,
    private readonly modelName: string = DASHSCOPE_CONFIG.DEFAULT_MODEL,
    private readonly fetchProxy?: FetchProxy,
    private readonly workerUrl?: string,
  ) {}

  getCapabilities(): LLMProviderCapabilities {
    return { supportsTextStreaming: true, supportsReasoningStreaming: false, contextWindow: 1_000_000 };
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature, maxTokens, responseSchema, toolConfig, onProgress, onThinking, abortSignal } = options;
    const body = this.buildRequestBody({ messages, tools, temperature, maxTokens, responseSchema, toolConfig });

    if ((onProgress || onThinking) && this.workerUrl) {
      return this.generateStreaming(body, onProgress, onThinking, abortSignal);
    }
    return this.generateSync(body);
  }

  async *generateStream(options: LLMGenerateOptions): AsyncIterable<LLMResponse> {
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

  // ── Request Building ─────────────────────────────────────────────────────────

  private buildRequestBody(opts: {
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    responseSchema?: Record<string, any>;
    toolConfig?: LLMGenerateOptions['toolConfig'];
  }): Record<string, any> {
    const { messages, tools, temperature, maxTokens, responseSchema, toolConfig } = opts;

    // Kimi K2.5 known issue: temperature < 1.0 causes empty tool_calls
    // (finish_reason=tool_calls but args=None). Official recommendation: 1.0.
    // We use 0.7 as a balance between determinism and avoiding the bug.
    const isKimiModel = this.modelName.toLowerCase().includes('kimi');
    const defaultTemp = isKimiModel ? 0.7 : 0.4;

    const body: any = {
      model: this.modelName,
      messages: mapMessagesToOpenAI(messages),
      temperature: temperature ?? defaultTemp,
      ...(maxTokens && { max_tokens: maxTokens }),
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      const mode = toolConfig?.mode || 'AUTO';
      if (mode === 'ANY') body.tool_choice = 'required';
      else if (mode === 'NONE') body.tool_choice = 'none';
      else body.tool_choice = 'auto';
    }

    if (responseSchema && !tools) {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'User-Agent': DASHSCOPE_CONFIG.USER_AGENT,
    };
  }

  private async generateSync(body: Record<string, any>): Promise<LLMResponse> {
    const url = `${DASHSCOPE_CONFIG.BASE_URL}/chat/completions`;
    const init = {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    };

    if (this.fetchProxy) {
      const result = await this.fetchProxy(url, init);
      if (!result.ok) {
        throw new APIError(this.name, result.status, result.body);
      }
      return this.assertNonEmpty(this.mapToLLMResponse(JSON.parse(result.body)));
    }

    // Direct fetch fallback (works in environments without CORS restrictions)
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e: any) {
      throw new TransportError(this.name, e?.message || 'fetch failed', e);
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new APIError(this.name, res.status, errText);
    }
    return this.assertNonEmpty(this.mapToLLMResponse(await res.json()));
  }

  /** Final empty-response gate. Throws EmptyResponseError if nothing usable. */
  private assertNonEmpty(response: LLMResponse): LLMResponse {
    const hasText = !!response.text && response.text.length > 0;
    const hasToolCalls = !!response.toolCalls && response.toolCalls.length > 0;
    if (!hasText && !hasToolCalls) {
      throw new EmptyResponseError(this.name);
    }
    return response;
  }

  /**
   * Fetch with retry for transient 5xx errors (e.g. Cloudflare 520).
   * Throws typed ProviderError on exhaustion. The runtime never retries
   * above this layer — this is the only retry layer in the system.
   */
  private async fetchWithRetry(body: Record<string, any>, abortSignal?: AbortSignal): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[DashScope] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        if (abortSignal?.aborted) throw new TransportError(this.name, 'Aborted during retry wait');
      }

      try {
        const res = await withConnectTimeout(
          () => fetch(`${this.workerUrl}/api/dashscope/generate`, {
            method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: abortSignal,
          }),
          CONNECT_TIMEOUT_MS,
        );

        if (res.ok) return res;

        const errText = await res.text();
        // Only retry on 5xx (server/infra errors). 4xx = client error, don't retry.
        if (res.status >= 500 && attempt < MAX_RETRIES) {
          console.warn(`[DashScope] ${res.status} error, will retry: ${errText.slice(0, 200)}`);
          lastError = new APIError(this.name, res.status, errText);
          continue;
        }
        throw new APIError(this.name, res.status, errText);
      } catch (e: any) {
        if (e?.name === 'AbortError') throw new TransportError(this.name, 'Aborted', e);
        // Connect timeout from withConnectTimeout
        if (typeof e?.message === 'string' && e.message.includes('Connection timed out')) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[DashScope] Connect timeout, will retry: ${e.message?.slice(0, 200)}`);
            lastError = new ConnectTimeoutError(this.name, CONNECT_TIMEOUT_MS);
            continue;
          }
          throw new ConnectTimeoutError(this.name, CONNECT_TIMEOUT_MS);
        }
        // Don't re-retry typed APIError 4xx
        if (e instanceof APIError && e.statusCode < 500) throw e;
        if (attempt < MAX_RETRIES) {
          console.warn(`[DashScope] Fetch failed, will retry: ${e?.message?.slice(0, 200)}`);
          lastError = e instanceof Error ? e : new TransportError(this.name, String(e));
          continue;
        }
        if (e instanceof Error) throw new TransportError(this.name, e.message, e);
        throw new TransportError(this.name, String(e));
      }
    }
    throw lastError ?? new TransportError(this.name, 'All retries exhausted');
  }

  private async generateStreaming(
    body: Record<string, any>,
    onProgress?: (chunk: string) => void,
    onThinking?: (thought: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<LLMResponse> {
    const res = await this.fetchWithRetry(body, abortSignal);

    const reader = res.body!.getReader();
    const accumulator = new ResponseAccumulator();
    // Accumulate incremental tool calls across SSE chunks
    const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

    let streamTimedOut = false;
    try {
      const { timedOut } = await consumeStream(this.parseSSEStream(reader), (parsed: any) => {
        const chunk = this.mapStreamChunkToLLMResponse(parsed, toolCallAccumulator);
        if (chunk.text) onProgress?.(chunk.text);
        if (chunk.thoughts) onThinking?.(chunk.thoughts);
        accumulator.append(chunk);
      }, { idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS, abortSignal });
      streamTimedOut = timedOut;
    } finally {
      reader.cancel().catch(() => {});
    }

    // Fail-fast on idle timeout. Pass partial text upstream for diagnostics.
    if (streamTimedOut) {
      throw new StreamIdleTimeoutError(this.name, STREAM_IDLE_TIMEOUT_MS, accumulator.getText());
    }

    // Finalize accumulated tool calls → inject into accumulator
    const finalResponse = accumulator.finalize();
    if (toolCallAccumulator.size > 0 && (!finalResponse.toolCalls || finalResponse.toolCalls.length === 0)) {
      const toolCalls: LLMToolCall[] = [];
      for (const [, tc] of toolCallAccumulator) {
        let parsedArgs: any;
        try { parsedArgs = JSON.parse(tc.args); } catch { parsedArgs = tc.args; }
        toolCalls.push({ id: tc.id, name: tc.name, args: parsedArgs });
      }
      finalResponse.toolCalls = toolCalls.length > 0 ? toolCalls : undefined;
    }

    // Guard: Kimi K2.5 known issue — finish_reason=tool_calls but args empty/null.
    // Discard broken tool calls at source so they never reach the agent loop.
    if (finalResponse.toolCalls) {
      finalResponse.toolCalls = finalResponse.toolCalls.filter(tc => {
        const hasArgs = tc.args != null
          && typeof tc.args === 'object'
          && Object.keys(tc.args).length > 0;
        if (!hasArgs) {
          console.warn(`[DashScope] Discarding empty tool call: ${tc.name} (known Kimi K2.5 issue)`);
        }
        return hasArgs;
      });
      if (finalResponse.toolCalls.length === 0) finalResponse.toolCalls = undefined;
    }

    return this.assertNonEmpty(finalResponse);
  }

  /** Converts raw SSE byte stream to parsed JSON objects */
  private async *parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<any> {
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
        try { yield JSON.parse(data); } catch { /* partial line */ }
      }
    }
  }

  // ── Response Mapping (OpenAI chat/completions format — non-streaming) ────────

  private mapToLLMResponse(data: any): LLMResponse {
    const response = mapOpenAIToLLMResponse(data);

    // Guard: discard tool calls with empty args (Kimi K2.5 known issue)
    if (response.toolCalls) {
      response.toolCalls = response.toolCalls.filter(tc => {
        const hasArgs = tc.args != null && typeof tc.args === 'object' && Object.keys(tc.args).length > 0;
        if (!hasArgs) console.warn(`[DashScope] Discarding empty tool call: ${tc.name}`);
        return hasArgs;
      });
      if (response.toolCalls.length === 0) response.toolCalls = undefined;
    }

    return response;
  }

  // ── Streaming Response Mapping (OpenAI delta format) ──────────────────────────

  /**
   * Maps a single SSE chunk (OpenAI streaming delta format) to LLMResponse.
   *
   * OpenAI streaming sends incremental deltas:
   * - choices[0].delta.content → text
   * - choices[0].delta.reasoning_content → thinking (kimi-k2.5 specific)
   * - choices[0].delta.tool_calls → incremental tool calls (index + partial args)
   * - usage → final chunk only
   *
   * Tool calls are accumulated in `toolCallAcc` across chunks because OpenAI
   * streams them incrementally (index + function.name on first chunk, then
   * function.arguments in subsequent chunks).
   */
  private mapStreamChunkToLLMResponse(
    data: any,
    toolCallAcc: Map<number, { id: string; name: string; args: string }>,
  ): LLMResponse {
    const choice = data.choices?.[0];
    const delta = choice?.delta;

    let text = '';
    let thoughts = '';

    if (delta?.content) text = delta.content;
    if (delta?.reasoning_content) thoughts = delta.reasoning_content;

    // Accumulate incremental tool calls by index
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
      // Tool calls returned only in finalize — not per-chunk (they're incremental)
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cachedTokens: data.usage.prompt_tokens_details?.cached_tokens || undefined,
      } : undefined,
      // finish_reason arrives in the final chunk (e.g. 'stop', 'length', 'tool_calls')
      finishReason: normalizeFinishReason(choice?.finish_reason),
    };
  }

}
