/**
 * @file proxy.ts
 * @description ProxyProvider — sends requests through the hosted Cloudflare Worker
 * instead of calling Gemini directly. API-key stays server-side; users authenticate
 * with a subscription token.
 *
 * Uses the same Gemini API protocol as GeminiProvider — shares format conversion
 * via gemini/geminiFormat.ts pure functions.
 */

import {
  LLMProvider,
  LLMGenerateOptions,
  LLMResponse,
  LLMMessage,
  LLMToolResult,
  LLMProviderCapabilities,
  getToolSystemInstructionDefault,
} from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { ResponseAccumulator } from './shared/responseAccumulator';
import { mapGeminiPartsToLLMResponse, mapLLMMessageToGeminiContent, buildGeminiGenerationConfig, buildGeminiToolsPayload, formatResponseGemini, formatToolResultsGemini } from './gemini/geminiFormat';
import { consumeStream, withConnectTimeout } from './shared/streamHandler';
import {
  ConnectTimeoutError,
  TransportError,
  APIError,
  EmptyResponseError,
} from './shared/providerErrors';

/** Connect timeout: max time to establish HTTP connection (ms) */
const CONNECT_TIMEOUT_MS = 15000;

export class ProxyProvider implements LLMProvider {
  public readonly name = 'proxy';

  constructor(
    private readonly workerUrl: string,
    private readonly subscriptionToken: string,
    private readonly modelName: string,
  ) {}

  getCapabilities(): LLMProviderCapabilities {
    return { supportsTextStreaming: true, supportsReasoningStreaming: true, contextWindow: 1_000_000 };
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig, onProgress, onThinking, abortSignal } = options;

    const body = this.buildRequestBody({ system: options.system, messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig });

    if (onProgress || onThinking) {
      return this.generateStreaming(body, onProgress, onThinking, abortSignal);
    }
    return this.generateSync(body);
  }

  async *generateStream(options: LLMGenerateOptions): AsyncIterable<LLMResponse> {
    yield await this.generate(options);
  }

  formatResponse(response: LLMResponse): LLMMessage {
    return formatResponseGemini(response);
  }

  formatToolResults(results: LLMToolResult[]): LLMMessage {
    return formatToolResultsGemini(results);
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
    thinkingLevel?: string;
    responseSchema?: Record<string, any>;
    toolConfig?: LLMGenerateOptions['toolConfig'];
  }): Record<string, any> {
    const { system, messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig } = opts;

    const generationConfig = buildGeminiGenerationConfig({
      modelName: this.modelName, temperature, maxTokens, thinkingLevel, responseSchema,
      hasTools: !!(tools && tools.length > 0),
    });

    const toolsResult = buildGeminiToolsPayload(tools, toolConfig);

    // System instruction — raw API requires {role, parts} format
    const systemInstruction = system
      ? { role: 'user', parts: [{ text: system }] }
      : undefined;

    return {
      model: this.modelName,
      contents: messages.map(m => mapLLMMessageToGeminiContent(m)),
      ...(systemInstruction && { systemInstruction }),
      generationConfig,
      ...(toolsResult && { tools: toolsResult.tools, toolConfig: toolsResult.toolConfig }),
    };
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.subscriptionToken}` };
  }

  private async generateSync(body: Record<string, any>): Promise<LLMResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.workerUrl}/api/generate-sync`, {
        method: 'POST', headers: this.authHeaders(), body: JSON.stringify(body),
      });
    } catch (e: any) {
      throw new TransportError(this.name, e?.message || 'fetch failed', e);
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new APIError(this.name, res.status, errText);
    }
    return this.assertNonEmpty(this.mapToLLMResponse(await res.json()));
  }

  private async generateStreaming(
    body: Record<string, any>,
    onProgress?: (chunk: string) => void,
    onThinking?: (thought: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<LLMResponse> {
    let res: Response;
    try {
      res = await withConnectTimeout(
        () => fetch(`${this.workerUrl}/api/generate`, {
          method: 'POST', headers: this.authHeaders(), body: JSON.stringify(body), signal: abortSignal,
        }),
        CONNECT_TIMEOUT_MS,
      );
    } catch (e: any) {
      if (typeof e?.message === 'string' && e.message.includes('Connection timed out')) {
        throw new ConnectTimeoutError(this.name, CONNECT_TIMEOUT_MS);
      }
      if (e?.name === 'AbortError') throw new TransportError(this.name, 'Aborted', e);
      throw new TransportError(this.name, e?.message || 'fetch failed', e);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new APIError(this.name, res.status, errText);
    }

    const reader = res.body!.getReader();
    const accumulator = new ResponseAccumulator();

    try {
      await consumeStream(this.parseSSEStream(reader), (parsed: any) => {
        const chunk = this.mapToLLMResponse(parsed);
        if (chunk.text) onProgress?.(chunk.text);
        if (chunk.thoughts) onThinking?.(chunk.thoughts);
        accumulator.append(chunk);
      }, { abortSignal });
    } finally {
      reader.cancel().catch(() => {});
    }

    return this.assertNonEmpty(accumulator.finalize());
  }

  /** Final empty-response gate. */
  private assertNonEmpty(response: LLMResponse): LLMResponse {
    const hasText = !!response.text && response.text.length > 0;
    const hasToolCalls = !!response.toolCalls && response.toolCalls.length > 0;
    if (!hasText && !hasToolCalls) {
      throw new EmptyResponseError(this.name);
    }
    return response;
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

  // ── Response Mapping (Gemini API format) ─────────────────────────────────────

  private mapToLLMResponse(response: any): LLMResponse {
    if (response?.error) {
      throw new APIError(this.name, response.error?.code ?? 0, JSON.stringify(response.error));
    }
    const parts: any[] = response?.candidates?.[0]?.content?.parts || [];
    return mapGeminiPartsToLLMResponse(parts, response.usageMetadata);
  }

}
