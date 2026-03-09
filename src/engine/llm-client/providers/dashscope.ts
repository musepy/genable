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
  Part,
  LLMProviderCapabilities,
  formatResponseDefault,
  formatToolResultsDefault,
  getToolSystemInstructionDefault,
} from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { DASHSCOPE_CONFIG } from '../config';
import { ResponseAccumulator } from './shared/responseAccumulator';
import { consumeStream, withConnectTimeout } from './shared/streamHandler';

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
    return { supportsTextStreaming: true, supportsReasoningStreaming: false };
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
      messages: this.mapMessages(messages),
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
        throw new Error(`[DashScope] API error ${result.status}: ${result.body}`);
      }
      return this.mapToLLMResponse(JSON.parse(result.body));
    }

    // Direct fetch fallback (works in environments without CORS restrictions)
    const res = await fetch(url, init);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[DashScope] API error ${res.status}: ${errText}`);
    }
    return this.mapToLLMResponse(await res.json());
  }

  private async generateStreaming(
    body: Record<string, any>,
    onProgress?: (chunk: string) => void,
    onThinking?: (thought: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<LLMResponse> {
    const res = await withConnectTimeout(
      () => fetch(`${this.workerUrl}/api/dashscope/generate`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: abortSignal,
      }),
      CONNECT_TIMEOUT_MS,
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[DashScope] Streaming error ${res.status}: ${errText}`);
    }

    const reader = res.body!.getReader();
    const accumulator = new ResponseAccumulator();
    // Accumulate incremental tool calls across SSE chunks
    const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

    try {
      const { timedOut } = await consumeStream(this.parseSSEStream(reader), (parsed: any) => {
        const chunk = this.mapStreamChunkToLLMResponse(parsed, toolCallAccumulator);
        if (chunk.text) onProgress?.(chunk.text);
        if (chunk.thoughts) onThinking?.(chunk.thoughts);
        accumulator.append(chunk);
      }, { idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS, abortSignal });

      if (timedOut) console.warn('[DashScope] Stream idle timeout. Returning partial result.');
    } finally {
      reader.cancel().catch(() => {});
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

    return finalResponse;
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
    const choice = data.choices?.[0];
    const message = choice?.message;

    const rawToolCalls: LLMToolCall[] | undefined = message?.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
    }));

    // Guard: discard tool calls with empty args (Kimi K2.5 known issue)
    const toolCalls = rawToolCalls?.filter(tc => {
      const hasArgs = tc.args != null && typeof tc.args === 'object' && Object.keys(tc.args).length > 0;
      if (!hasArgs) console.warn(`[DashScope] Discarding empty tool call: ${tc.name}`);
      return hasArgs;
    });

    return {
      text: message?.content || '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cachedTokens: data.usage.prompt_tokens_details?.cached_tokens || undefined,
      } : undefined,
    };
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
    };
  }

  // ── Message Mapping ──────────────────────────────────────────────────────────

  private mapMessages(messages: LLMMessage[]): any[] {
    const mapped: any[] = [];

    for (const m of messages) {
      let role: string = m.role;
      if (role === 'model') role = 'assistant';

      // Tool results → individual messages per OpenAI spec
      if (m.role === 'tool' && Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.functionResponse) {
            mapped.push({
              role: 'tool',
              tool_call_id: part.tool_call_id || 'unknown',
              content: JSON.stringify(part.functionResponse.response),
            });
          }
        }
        continue;
      }

      let content: any = m.content;
      if (Array.isArray(m.content)) {
        content = m.content.map((p: Part) => {
          if (p.text) return { type: 'text', text: p.text };
          if (p.inlineData) return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
          return null;
        }).filter(Boolean);
        if (content.length === 1 && content[0].type === 'text') content = content[0].text;
        else if (content.length === 0) content = null;
      }

      const msg: any = { role, content };

      // Assistant tool calls
      if (m.role === 'model' && Array.isArray(m.content)) {
        const tcs = m.content
          .filter((p: Part) => p.functionCall)
          .map((p: Part) => ({
            id: p.tool_call_id || randomId('call_'),
            type: 'function',
            function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args) },
          }));
        if (tcs.length > 0) {
          msg.tool_calls = tcs;
          if (!msg.content) msg.content = null;
        }
      }

      mapped.push(msg);
    }

    return mapped;
  }
}
