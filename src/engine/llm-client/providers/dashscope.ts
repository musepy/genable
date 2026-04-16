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
  ToolCallBlock,
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
  ConnectTimeoutError,
  TransportError,
  APIError,
  EmptyResponseError,
} from './shared/providerErrors';

export type FetchProxy = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; body: string }>;

/** Connect timeout: max time until first byte from Worker proxy (ms).
 * DashScope TTFB through Worker can be 10-30s+ due to cross-border latency
 * (Cloudflare edge → China datacenter) plus model reasoning time. */
const CONNECT_TIMEOUT_MS = 90000;

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
    const body = this.buildRequestBody({ system: options.system, messages, tools, temperature, maxTokens, responseSchema, toolConfig });

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
    system?: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    responseSchema?: Record<string, any>;
    toolConfig?: LLMGenerateOptions['toolConfig'];
  }): Record<string, any> {
    const { system, messages, tools, temperature, maxTokens, responseSchema, toolConfig } = opts;

    // Kimi K2.5 known issue: temperature < 1.0 causes empty tool_calls
    // (finish_reason=tool_calls but args=None). Official recommendation: 1.0.
    // We use 0.7 as a balance between determinism and avoiding the bug.
    const isKimiModel = this.modelName.toLowerCase().includes('kimi');
    const defaultTemp = isKimiModel ? 0.7 : 0.4;

    // System prompt → first message (OpenAI format)
    const openAIMessages = mapMessagesToOpenAI(messages);
    if (system) {
      openAIMessages.unshift({ role: 'system', content: system });
    }

    const body: any = {
      model: this.modelName,
      messages: openAIMessages,
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
   * One-shot fetch against the streaming Worker endpoint.
   * Translates transport/HTTP errors into typed ProviderError so the shared
   * withRetry layer (in LLMGenerationCoordinator) decides retry — this
   * provider no longer owns its own retry loop.
   *
   * CONNECT_TIMEOUT_MS is kept: it's the cross-border TTFB guard, not a
   * retry policy. Without it, a stalled proxy connection would hang forever.
   */
  private async fetchStreaming(body: Record<string, any>, abortSignal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await withConnectTimeout(
        () => fetch(`${this.workerUrl}/api/dashscope/generate`, {
          method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: abortSignal,
        }),
        CONNECT_TIMEOUT_MS,
      );
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new TransportError(this.name, 'Aborted', e);
      if (typeof e?.message === 'string' && e.message.includes('Connection timed out')) {
        throw new ConnectTimeoutError(this.name, CONNECT_TIMEOUT_MS);
      }
      if (e instanceof Error) throw new TransportError(this.name, e.message, e);
      throw new TransportError(this.name, String(e));
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new APIError(this.name, res.status, errText);
    }
    return res;
  }

  private async generateStreaming(
    body: Record<string, any>,
    onProgress?: (chunk: string) => void,
    onThinking?: (thought: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<LLMResponse> {
    const res = await this.fetchStreaming(body, abortSignal);

    const reader = res.body!.getReader();
    const accumulator = new ResponseAccumulator();
    // Accumulate incremental tool calls across SSE chunks
    const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

    try {
      await consumeStream(this.parseSSEStream(reader), (parsed: any) => {
        const chunk = this.mapStreamChunkToLLMResponse(parsed, toolCallAccumulator);
        if (chunk.text) onProgress?.(chunk.text);
        if (chunk.thoughts) onThinking?.(chunk.thoughts);
        accumulator.append(chunk);
      }, { abortSignal });
    } finally {
      reader.cancel().catch(() => {});
    }

    // Finalize accumulated tool calls → inject into accumulator
    const finalResponse = accumulator.finalize();
    if (toolCallAccumulator.size > 0 && (!finalResponse.toolCalls || finalResponse.toolCalls.length === 0)) {
      const toolCalls: ToolCallBlock[] = [];
      for (const [, tc] of toolCallAccumulator) {
        let parsedArgs: any;
        try { parsedArgs = JSON.parse(tc.args); } catch { parsedArgs = tc.args; }
        toolCalls.push({ type: 'tool_call' as const, id: tc.id, name: tc.name, input: parsedArgs });
      }
      finalResponse.toolCalls = toolCalls.length > 0 ? toolCalls : undefined;
    }

    // Guard: Kimi K2.5 known issue — finish_reason=tool_calls but args empty/null.
    // Discard broken tool calls at source so they never reach the agent loop.
    if (finalResponse.toolCalls) {
      finalResponse.toolCalls = finalResponse.toolCalls.filter(tc => {
        const hasInput = tc.input != null
          && typeof tc.input === 'object'
          && Object.keys(tc.input).length > 0;
        if (!hasInput) {
          console.warn(`[DashScope] Discarding empty tool call: ${tc.name} (known Kimi K2.5 issue)`);
        }
        return hasInput;
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

    // Guard: discard tool calls with empty input (Kimi K2.5 known issue)
    if (response.toolCalls) {
      response.toolCalls = response.toolCalls.filter(tc => {
        const hasInput = tc.input != null && typeof tc.input === 'object' && Object.keys(tc.input).length > 0;
        if (!hasInput) console.warn(`[DashScope] Discarding empty tool call: ${tc.name}`);
        return hasInput;
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
