/**
 * @file proxy.ts
 * @description ProxyProvider — sends requests through the hosted Cloudflare Worker
 * instead of calling Gemini directly. API-key stays server-side; users authenticate
 * with a subscription token.
 *
 * Uses the same Gemini API protocol as GeminiProvider — shares response mapping
 * via GeminiProvider.mapToLLMResponse() and content mapping logic.
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
  getToolSystemInstructionDefault,
} from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { isGemini3Model } from '../modelFilter';
import { GEMINI_CONFIG } from '../config';
import { ResponseAccumulator } from './shared/responseAccumulator';
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
    const isGemini3 = isGemini3Model(this.modelName);

    const systemMessages = messages.filter(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    const effectiveMaxTokens = maxTokens || GEMINI_CONFIG.MAX_OUTPUT_TOKENS;

    const generationConfig: Record<string, any> = {
      temperature: temperature ?? 0.4,
      maxOutputTokens: effectiveMaxTokens,
    };

    if (thinkingLevel) {
      if (isGemini3) {
        let apiLevel = thinkingLevel.toUpperCase();
        if (apiLevel === 'MINIMAL') apiLevel = 'LOW';
        generationConfig.thinkingConfig = { thinkingLevel: apiLevel };
      } else {
        const budgetMap: Record<string, number> = { minimal: 1024, low: 4096, medium: 10_240, high: 16_384 };
        generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: budgetMap[thinkingLevel] ?? 4096 };
      }
    }

    if (responseSchema && !tools) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = responseSchema;
    }

    const toolsPayload = tools && tools.length > 0
      ? [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
      : undefined;

    let toolConfigPayload: any;
    if (toolsPayload) {
      let mode = toolConfig?.mode || 'AUTO';
      if (mode === 'ANY' && tools && tools.length > 12) mode = 'AUTO';
      const allowed = toolConfig?.allowedTools;
      const declarationNames = tools?.map(t => t.name) || [];
      const safeAllowed = allowed?.filter(n => declarationNames.includes(n));
      toolConfigPayload = {
        functionCallingConfig: { mode, allowedFunctionNames: safeAllowed && safeAllowed.length > 0 ? safeAllowed : undefined },
      };
    }

    const systemInstruction = systemMessages.length > 0
      ? { role: 'user', parts: [{ text: systemMessages
          .map(m => typeof m.content === 'string' ? m.content : (m.content as any[]).map(p => p.text).join('\n'))
          .join('\n\n') }] }
      : undefined;

    return {
      model: this.modelName,
      contents: chatMessages.map(m => this.mapMessageToContent(m)),
      ...(systemInstruction && { systemInstruction }),
      generationConfig,
      ...(toolsPayload && { tools: toolsPayload }),
      ...(toolConfigPayload && { toolConfig: toolConfigPayload }),
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
    let text = '';
    let thoughts = '';
    const toolCalls: LLMToolCall[] = [];
    const fullParts: Part[] = [];

    const sharedSignature = parts.find((p: any) => p.thoughtSignature || p.thought_signature)
      ?.thoughtSignature ?? parts.find((p: any) => p.thought_signature)?.thought_signature;

    for (const part of parts) {
      const sig = part.thoughtSignature || part.thought_signature || sharedSignature;

      if (part.functionCall) {
        const tc: LLMToolCall = {
          id: part.functionCall.id || randomId('call_'),
          name: part.functionCall.name, args: part.functionCall.args,
          metadata: sig ? { thought_signature: sig } : undefined,
          thought_signature: sig,
        };
        toolCalls.push(tc);
        fullParts.push({ ...part, functionCall: { ...part.functionCall, id: tc.id }, thought_signature: sig });
      } else if (part.thought) {
        const thoughtText = typeof part.thought === 'string' ? part.thought : (part.text || '');
        if (thoughtText) thoughts += thoughtText;
        fullParts.push({ ...part, thought_signature: sig } as any);
      } else if (part.text) {
        text += part.text;
        fullParts.push({ ...part, thought_signature: sig } as any);
      }
    }

    return {
      text, thoughts: thoughts || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      fullParts: fullParts.length > 0 ? fullParts : undefined,
      usage: response.usageMetadata ? {
        promptTokens: response.usageMetadata.promptTokenCount || 0,
        completionTokens: response.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata.totalTokenCount || 0,
        cachedTokens: response.usageMetadata.cachedContentTokenCount || undefined,
      } : undefined,
    };
  }

  // ── Content Mapping ──────────────────────────────────────────────────────────

  private mapMessageToContent(msg: LLMMessage): any {
    const role = msg.role === 'model' ? 'model' : 'user';
    const parts = typeof msg.content === 'string'
      ? [{ text: msg.content }]
      : (msg.content as any[]).map((p: any) => {
        const sig = (p.thought_signature || p.thoughtSignature) ? ensureBase64(p.thought_signature || p.thoughtSignature) : undefined;

        if (p.thought) {
          if (p.thought === true && p.text) return { text: p.text, thought: true, ...(sig && { thoughtSignature: sig }) };
          return { thought: p.thought, ...(sig && { thoughtSignature: sig }) };
        }
        if (p.functionCall) return { functionCall: { name: p.functionCall.name, args: p.functionCall.args }, ...(sig && { thoughtSignature: sig }) };
        if (p.functionResponse) return { functionResponse: { name: p.functionResponse.name, response: p.functionResponse.response }, ...(sig && { thoughtSignature: sig }) };
        if (p.inlineData) return { inlineData: { mimeType: p.inlineData.mimeType, data: p.inlineData.data } };
        if (p.text) return { text: p.text };
        return { text: '' };
      }).filter((p: any) => {
        if (p.text === '' && Object.keys(p).length === 1) return false;
        return p.text !== undefined || p.thought !== undefined || p.functionCall !== undefined || p.functionResponse !== undefined || p.inlineData !== undefined;
      });

    return { role, parts };
  }
}

function ensureBase64(str: string): string {
  if (!str) return '';
  const b64Regex = /^[A-Za-z0-9+/_-]+=*$/;
  if (b64Regex.test(str)) return str;
  try { return Buffer.from(str).toString('base64'); } catch { return str; }
}
