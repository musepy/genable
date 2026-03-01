/**
 * @file proxy.ts
 * @description ProxyProvider — sends requests through the hosted Cloudflare Worker
 * instead of calling Gemini directly. API-key stays server-side; users authenticate
 * with a subscription token.
 *
 * Drop-in replacement for GeminiProvider: implements the same LLMProvider interface.
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
} from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { isGemini3Model } from '../modelFilter';
import { GEMINI_CONFIG } from '../config';
import { GeminiResponseAccumulator } from './gemini/geminiResponseAccumulator';

// ─── Utility ─────────────────────────────────────────────────────────────────

function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(7);
}

// ─── ProxyProvider ────────────────────────────────────────────────────────────

export class ProxyProvider implements LLMProvider {
  public readonly name = 'proxy';

  /** Default SSE stream timeout: 60 s (longer than direct Gemini due to network hop) */
  private static readonly DEFAULT_STREAM_TIMEOUT_MS = 60_000;

  constructor(
    private readonly workerUrl: string,
    private readonly subscriptionToken: string,
    private readonly modelName: string
  ) {}

  getCapabilities(): LLMProviderCapabilities {
    return {
      supportsTextStreaming: true,
      supportsReasoningStreaming: true,
    };
  }

  // ── Public LLMProvider interface ────────────────────────────────────────────

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const {
      messages,
      tools,
      temperature,
      maxTokens,
      thinkingLevel,
      responseSchema,
      toolConfig,
      onProgress,
      onThinking,
      abortSignal,
      streamTimeoutMs,
    } = options;

    const body = this.buildRequestBody({
      messages,
      tools,
      temperature,
      maxTokens,
      thinkingLevel,
      responseSchema,
      toolConfig,
    });

    if (onProgress || onThinking) {
      return this.generateStreaming(body, onProgress, onThinking, abortSignal, streamTimeoutMs);
    }

    return this.generateSync(body);
  }

  async *generateStream(options: LLMGenerateOptions): AsyncIterable<LLMResponse> {
    const res = await this.generate(options);
    yield res;
  }

  formatResponse(response: LLMResponse): LLMMessage {
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        id: randomId('mdl_'),
        role: 'model',
        content: response.text || '',
      };
    }

    const content: Part[] = (response.fullParts || []).filter((p: any) => {
      return p.functionCall || p.thought || (p.text && p.text.trim() !== '');
    });

    return {
      id: randomId('mdl_'),
      role: 'model',
      content,
    };
  }

  formatToolResults(results: LLMToolResult[]): LLMMessage {
    return {
      id: randomId('tol_'),
      role: 'tool',
      content: results.map(tr => ({
        functionResponse: { name: tr.name, response: tr.response },
        thought_signature: tr.thought_signature,
      } as any)),
    };
  }

  getToolSystemInstruction(tools: ToolDefinition[]): string {
    if (!tools || tools.length === 0) return '';
    try {
      const { TOOL_CALLING_PROTOCOL } = require('../../prompt/promptRegistry');
      return TOOL_CALLING_PROTOCOL;
    } catch {
      return '';
    }
  }

  // ── Request building ─────────────────────────────────────────────────────────

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

    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const effectiveMaxTokens = maxTokens || GEMINI_CONFIG.MAX_OUTPUT_TOKENS;

    // ── generationConfig ──
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
        const budgetMap: Record<string, number> = {
          minimal: 1024, low: 4096, medium: 10_240, high: 16_384,
        };
        const budget = budgetMap[thinkingLevel] ?? 4096;
        generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: budget };
      }
    }

    if (responseSchema && !tools) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = responseSchema;
    }

    // ── tools ──
    const toolsPayload: any[] | undefined = tools && tools.length > 0
      ? [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
      : undefined;

    // ── toolConfig ──
    let toolConfigPayload: any | undefined;
    if (toolsPayload) {
      let mode = toolConfig?.mode || 'AUTO';
      const ANY_MODE_LIMIT = 12;
      if (mode === 'ANY' && tools && tools.length > ANY_MODE_LIMIT) mode = 'AUTO';

      const allowed = toolConfig?.allowedTools;
      const declarationNames = tools?.map(t => t.name) || [];
      const safeAllowed = allowed?.filter(n => declarationNames.includes(n));

      toolConfigPayload = {
        functionCallingConfig: {
          mode,
          allowedFunctionNames: safeAllowed && safeAllowed.length > 0 ? safeAllowed : undefined,
        },
      };
    }

    // ── systemInstruction ──
    const systemInstruction = systemMessage
      ? {
          role: 'user',
          parts: [
            {
              text: typeof systemMessage.content === 'string'
                ? systemMessage.content
                : (systemMessage.content as any[]).map(p => p.text).join('\n'),
            },
          ],
        }
      : undefined;

    // ── contents ──
    const contents = chatMessages.map(m => this.mapMessageToContent(m));

    return {
      // model is used by the Worker to build the upstream URL
      model: this.modelName,
      contents,
      ...(systemInstruction && { systemInstruction }),
      generationConfig,
      ...(toolsPayload && { tools: toolsPayload }),
      ...(toolConfigPayload && { toolConfig: toolConfigPayload }),
    };
  }

  // ── HTTP calls ───────────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.subscriptionToken}`,
    };
  }

  /** Non-streaming path: POST /api/generate-sync */
  private async generateSync(body: Record<string, any>): Promise<LLMResponse> {
    const res = await fetch(`${this.workerUrl}/api/generate-sync`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[ProxyProvider] Upstream error ${res.status}: ${errText}`);
    }

    const data = await res.json() as any;
    return this.mapToLLMResponse(data);
  }

  /** Streaming path: POST /api/generate → SSE */
  private async generateStreaming(
    body: Record<string, any>,
    onProgress?: (chunk: string) => void,
    onThinking?: (thought: string) => void,
    abortSignal?: AbortSignal,
    streamTimeoutMs?: number,
  ): Promise<LLMResponse> {
    const res = await fetch(`${this.workerUrl}/api/generate`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[ProxyProvider] Upstream error ${res.status}: ${errText}`);
    }

    const accumulator = new GeminiResponseAccumulator();
    const timeout = streamTimeoutMs || ProxyProvider.DEFAULT_STREAM_TIMEOUT_MS;
    const startTime = Date.now();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let timedOut = false;

    try {
      while (true) {
        if (abortSignal?.aborted) {
          console.warn('[ProxyProvider] Stream aborted');
          break;
        }
        if (Date.now() - startTime > timeout) {
          console.warn(`[ProxyProvider] Stream timeout after ${timeout}ms`);
          timedOut = true;
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            const chunk = this.mapToLLMResponse(parsed);
            if (chunk.text) onProgress?.(chunk.text);
            if (chunk.thoughts) onThinking?.(chunk.thoughts);
            accumulator.append(chunk);
          } catch {
            // Partial or non-JSON line — ignore
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    if (timedOut) {
      console.warn('[ProxyProvider] Stream timed out. Returning partial result.');
    }

    return accumulator.finalize();
  }

  // ── Response mapping ─────────────────────────────────────────────────────────

  /** Maps a raw Gemini REST API response object to LLMResponse */
  private mapToLLMResponse(response: any): LLMResponse {
    if (response?.error) {
      throw new Error(`[ProxyProvider] Gemini error: ${JSON.stringify(response.error)}`);
    }

    const candidate = response?.candidates?.[0];
    const parts: any[] = candidate?.content?.parts || [];

    let text = '';
    let thoughts = '';
    const toolCalls: LLMToolCall[] = [];
    const fullParts: Part[] = [];

    const sharedSignature = parts.find((p: any) => p.thoughtSignature || p.thought_signature)
      ?.thoughtSignature ?? parts.find((p: any) => p.thought_signature)?.thought_signature;

    for (const part of parts) {
      if (part.functionCall) {
        const sig = part.thoughtSignature || part.thought_signature || sharedSignature;
        const tc: LLMToolCall = {
          id: part.functionCall.id || randomId('call_'),
          name: part.functionCall.name,
          args: part.functionCall.args,
          metadata: sig ? { thought_signature: sig } : undefined,
          thought_signature: sig,
        };
        toolCalls.push(tc);
        fullParts.push({ ...part, functionCall: { ...part.functionCall, id: tc.id }, thought_signature: sig });
      } else if (part.thought) {
        const thoughtText = typeof part.thought === 'string' ? part.thought : (part.text || '');
        if (thoughtText) thoughts += thoughtText;
        const sig = part.thoughtSignature || part.thought_signature || sharedSignature;
        fullParts.push({ ...part, thought_signature: sig } as any);
      } else if (part.text) {
        text += part.text;
        const sig = part.thoughtSignature || part.thought_signature || sharedSignature;
        fullParts.push({ ...part, thought_signature: sig } as any);
      }
    }

    const usage = response.usageMetadata
      ? {
          promptTokens: response.usageMetadata.promptTokenCount || 0,
          completionTokens: response.usageMetadata.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    return {
      text,
      thoughts: thoughts || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      fullParts: fullParts.length > 0 ? fullParts : undefined,
      usage,
    };
  }

  // ── Message mapping ──────────────────────────────────────────────────────────

  private mapMessageToContent(msg: LLMMessage): any {
    const role = msg.role === 'model' ? 'model' : 'user';

    const parts =
      typeof msg.content === 'string'
        ? [{ text: msg.content }]
        : (msg.content as any[])
            .map((p: any) => {
              const sig = p.thought_signature || p.thoughtSignature
                ? this.ensureBase64(p.thought_signature || p.thoughtSignature)
                : undefined;

              if (p.thought) {
                if (p.thought === true && p.text) return { text: p.text, thought: true, ...(sig && { thoughtSignature: sig }) };
                return { thought: p.thought, ...(sig && { thoughtSignature: sig }) };
              }
              if (p.functionCall) {
                return {
                  functionCall: { name: p.functionCall.name, args: p.functionCall.args },
                  ...(sig && { thoughtSignature: sig }),
                };
              }
              if (p.functionResponse) {
                return {
                  functionResponse: { name: p.functionResponse.name, response: p.functionResponse.response },
                  ...(sig && { thoughtSignature: sig }),
                };
              }
              if (p.text) return { text: p.text };
              return { text: '' };
            })
            .filter((p: any) => {
              if (p.text === '' && Object.keys(p).length === 1) return false;
              return p.text !== undefined || p.thought !== undefined || p.functionCall !== undefined || p.functionResponse !== undefined;
            });

    return { role, parts };
  }

  private ensureBase64(str: string): string {
    if (!str) return '';
    const b64Regex = /^[A-Za-z0-9+/_-]+=*$/;
    if (b64Regex.test(str)) return str;
    try {
      return Buffer.from(str).toString('base64');
    } catch {
      return str;
    }
  }
}
