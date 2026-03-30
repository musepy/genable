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
  Part,
  LLMProviderCapabilities,
  getToolSystemInstructionDefault,
} from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { ResponseAccumulator } from './shared/responseAccumulator';
import { mapGeminiPartsToLLMResponse, mapLLMMessageToGeminiContent, buildGeminiGenerationConfig, buildGeminiToolsPayload } from './gemini/geminiFormat';
import { consumeStream, withConnectTimeout } from './shared/streamHandler';

/** Idle timeout: max silence between chunks (ms). Longer than direct Gemini due to network hop. */
const STREAM_IDLE_TIMEOUT_MS = 45000;
/** Connect timeout: max time to establish HTTP connection (ms) */
const CONNECT_TIMEOUT_MS = 15000;

function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(7);
}

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

    const body = this.buildRequestBody({ messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig });

    if (onProgress || onThinking) {
      return this.generateStreaming(body, onProgress, onThinking, abortSignal);
    }
    return this.generateSync(body);
  }

  async *generateStream(options: LLMGenerateOptions): AsyncIterable<LLMResponse> {
    yield await this.generate(options);
  }

  formatResponse(response: LLMResponse): LLMMessage {
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return { id: randomId('mdl_'), role: 'model', content: response.text || '' };
    }
    const content: Part[] = (response.fullParts || []).filter((p: any) => {
      return p.functionCall || p.thought || (p.text && p.text.trim() !== '');
    });
    return { id: randomId('mdl_'), role: 'model', content };
  }

  formatToolResults(results: LLMToolResult[]): LLMMessage {
    const content: Part[] = [];
    for (const tr of results) {
      content.push({ functionResponse: { name: tr.name, response: tr.response }, thought_signature: tr.thought_signature } as any);
      if (tr.imageAttachment) {
        content.push({ inlineData: { mimeType: tr.imageAttachment.mimeType, data: tr.imageAttachment.data } });
      }
    }
    return { id: randomId('tol_'), role: 'tool', content };
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
    thinkingLevel?: string;
    responseSchema?: Record<string, any>;
    toolConfig?: LLMGenerateOptions['toolConfig'];
  }): Record<string, any> {
    const { messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig } = opts;

    const systemMessages = messages.filter(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const generationConfig = buildGeminiGenerationConfig({
      modelName: this.modelName, temperature, maxTokens, thinkingLevel, responseSchema,
      hasTools: !!(tools && tools.length > 0),
    });

    const toolsResult = buildGeminiToolsPayload(tools, toolConfig);

    // System instruction — raw API requires {role, parts} format
    const systemInstruction = systemMessages.length > 0
      ? { role: 'user', parts: [{ text: systemMessages
          .map(m => typeof m.content === 'string' ? m.content : (m.content as any[]).map(p => p.text).join('\n'))
          .join('\n\n') }] }
      : undefined;

    return {
      model: this.modelName,
      contents: chatMessages.map(m => mapLLMMessageToGeminiContent(m)),
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
    const res = await fetch(`${this.workerUrl}/api/generate-sync`, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[ProxyProvider] Upstream error ${res.status}: ${errText}`);
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
      () => fetch(`${this.workerUrl}/api/generate`, {
        method: 'POST', headers: this.authHeaders(), body: JSON.stringify(body), signal: abortSignal,
      }),
      CONNECT_TIMEOUT_MS,
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[ProxyProvider] Upstream error ${res.status}: ${errText}`);
    }

    const reader = res.body!.getReader();
    const accumulator = new ResponseAccumulator();

    try {
      const { timedOut } = await consumeStream(this.parseSSEStream(reader), (parsed: any) => {
        const chunk = this.mapToLLMResponse(parsed);
        if (chunk.text) onProgress?.(chunk.text);
        if (chunk.thoughts) onThinking?.(chunk.thoughts);
        accumulator.append(chunk);
      }, { idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS, abortSignal });

      if (timedOut) console.warn('[ProxyProvider] Stream idle timeout. Returning partial result.');
    } finally {
      reader.cancel().catch(() => {});
    }

    return accumulator.finalize();
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
    if (response?.error) throw new Error(`[ProxyProvider] Gemini error: ${JSON.stringify(response.error)}`);
    const parts: any[] = response?.candidates?.[0]?.content?.parts || [];
    return mapGeminiPartsToLLMResponse(parts, response.usageMetadata);
  }

}
