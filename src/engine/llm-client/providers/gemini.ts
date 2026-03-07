/**
 * @file gemini.ts
 * @description Gemini LLM Provider — direct SDK access via @google/genai.
 */

import { GoogleGenAI } from '@google/genai';
import { LLMProvider, LLMGenerateOptions, LLMResponse, LLMMessage, LLMToolCall, Part, LLMToolResult, getToolSystemInstructionDefault } from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { isGemini3Model } from '../modelFilter';
import { GEMINI_CONFIG } from '../config';
import { GeminiErrorHandler } from './gemini/geminiErrorHandler';
import { GeminiLogger } from './gemini/geminiLogger';
import { ResponseAccumulator } from './shared/responseAccumulator';
import { consumeStream, withConnectTimeout } from './shared/streamHandler';

/** Idle timeout: max silence between chunks (ms) */
const STREAM_IDLE_TIMEOUT_MS = 30000;
/** Connect timeout: max time to establish the streaming connection (ms) */
const CONNECT_TIMEOUT_MS = 15000;

export class GeminiProvider implements LLMProvider {
  public readonly name = 'gemini';
  private client: any;

  constructor(private apiKey: string, private modelName: string, options?: { accessToken?: string; vertexProject?: string; vertexLocation?: string }) {
    if (options?.accessToken && options?.vertexProject) {
      this.client = new GoogleGenAI({
        vertexai: true,
        project: options.vertexProject,
        location: options.vertexLocation || 'us-central1',
        httpOptions: {
          headers: { 'Authorization': `Bearer ${options.accessToken}` },
        },
      });
    } else {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  getCapabilities() {
    return { supportsTextStreaming: true, supportsReasoningStreaming: true };
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig, onProgress, onThinking, abortSignal } = options;

    GeminiLogger.info(`generate() called, tools=${tools?.length || 0}, toolConfig=${JSON.stringify(toolConfig)}`);

    const config = this.buildConfig({ messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig });
    const contents = messages.filter(m => m.role !== 'system').map(m => this.mapToGenAIContent(m));

    if (onProgress || onThinking) {
      return this.generateStreaming(contents, config, onProgress, onThinking, abortSignal);
    }

    let response;
    try {
      response = await (this.client as any).models.generateContent({
        model: this.modelName, contents, config,
      });
    } catch (error: any) {
      GeminiErrorHandler.handleSdkError(error);
    }
    return this.mapToLLMResponse(response);
  }

  getToolSystemInstruction(tools: ToolDefinition[]): string {
    return getToolSystemInstructionDefault(tools);
  }

  async *generateStream(options: LLMGenerateOptions): AsyncIterable<LLMResponse> {
    yield await this.generate(options);
  }

  formatResponse(response: LLMResponse): LLMMessage {
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return { id: 'mdl_' + Math.random().toString(36).substring(7), role: 'model', content: response.text || '' };
    }

    const content = (response.fullParts || []).filter((p: any) => {
      return p.functionCall || p.thought || (p.text && p.text.trim() !== '');
    });

    return { id: 'mdl_' + Math.random().toString(36).substring(7), role: 'model', content };
  }

  formatToolResults(results: LLMToolResult[]): LLMMessage {
    const content: Part[] = [];
    for (const tr of results) {
      content.push({
        functionResponse: { name: tr.name, response: tr.response },
        thought_signature: tr.thought_signature,
      } as any);
      if (tr.imageAttachment) {
        content.push({ inlineData: { mimeType: tr.imageAttachment.mimeType, data: tr.imageAttachment.data } });
      }
    }
    return { id: 'tol_' + Math.random().toString(36).substring(7), role: 'tool', content };
  }

  // ── Config Building ──────────────────────────────────────────────────────────

  private buildConfig(opts: {
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    thinkingLevel?: string;
    responseSchema?: Record<string, any>;
    toolConfig?: LLMGenerateOptions['toolConfig'];
  }): any {
    const { messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig } = opts;
    const isGemini3 = isGemini3Model(this.modelName);

    const config: any = {
      temperature: temperature ?? 0.4,
      maxOutputTokens: maxTokens || GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
    };

    // Thinking config
    if (thinkingLevel) {
      if (isGemini3) {
        let apiLevel = thinkingLevel.toUpperCase();
        if (apiLevel === 'MINIMAL') apiLevel = 'LOW';
        config.thinkingConfig = { thinkingLevel: apiLevel };
      } else {
        const budgetMap: Record<string, number> = { minimal: 1024, low: 4096, medium: 10240, high: 16384 };
        config.thinkingConfig = { includeThoughts: true, thinkingBudget: budgetMap[thinkingLevel] ?? 4096 };
      }
    }

    // Response schema
    if (responseSchema && !tools) {
      config.responseMimeType = 'application/json';
      config.responseSchema = responseSchema;
    }

    // System instruction
    const systemMessage = messages.find(m => m.role === 'system');
    if (systemMessage) {
      config.systemInstruction = typeof systemMessage.content === 'string'
        ? systemMessage.content
        : (systemMessage.content as any[]).map(p => p.text).join('\n');
    }

    // Tools + tool config
    if (tools && tools.length > 0) {
      config.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];

      let mode = toolConfig?.mode || 'AUTO';
      const ANY_MODE_TOOL_LIMIT = 12;
      if (mode === 'ANY' && tools.length > ANY_MODE_TOOL_LIMIT) {
        console.warn(`[GeminiProvider] Downgrading toolConfig mode from ANY to AUTO: ${tools.length} tools exceeds limit ~${ANY_MODE_TOOL_LIMIT}`);
        mode = 'AUTO';
      }

      const allowed = toolConfig?.allowedTools;
      const declarationNames = tools.map(t => t.name);
      const safeAllowed = allowed?.filter(name => declarationNames.includes(name));

      config.toolConfig = {
        functionCallingConfig: {
          mode,
          allowedFunctionNames: (safeAllowed && safeAllowed.length > 0) ? safeAllowed : undefined,
        },
      };
    }

    return config;
  }

  // ── Streaming ────────────────────────────────────────────────────────────────

  private async generateStreaming(
    contents: any[],
    config: any,
    onProgress?: (chunk: string) => void,
    onThinking?: (thought: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<LLMResponse> {
    let stream: AsyncIterable<any>;
    try {
      stream = await withConnectTimeout(
        () => (this.client as any).models.generateContentStream({ model: this.modelName, contents, config }),
        CONNECT_TIMEOUT_MS,
      );
    } catch (error: any) {
      GeminiErrorHandler.handleSdkError(error);
      throw error; // unreachable, but satisfies TS control flow
    }

    const accumulator = new ResponseAccumulator();
    let streamTruncated = false;

    try {
      const { timedOut, aborted } = await consumeStream(stream, (response: any) => {
        const mapped = this.mapToLLMResponse(response);
        if (mapped.text) onProgress?.(mapped.text);
        if (mapped.thoughts) onThinking?.(mapped.thoughts);
        accumulator.append(mapped);
      }, { idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS, abortSignal });

      if (!timedOut && !aborted) {
        GeminiErrorHandler.validateResponseContent(accumulator.getText(), accumulator.getToolCalls(), accumulator.getThoughts());
      } else {
        const reason = timedOut ? 'timed out' : 'aborted';
        GeminiLogger.warn(`Stream ${reason}. Accumulated: ${accumulator.getText().length} chars text, ${accumulator.getToolCalls().length} tool calls`);
      }
    } catch (streamError: any) {
      if (streamError?.message?.includes('Incomplete JSON segment')) {
        GeminiLogger.warn(`Stream truncated (SDK SSE buffer not empty). Accumulated: ${accumulator.getText().length} chars text, ${accumulator.getToolCalls().length} tool calls`);
        streamTruncated = true;
      } else {
        throw streamError;
      }
    }

    return accumulator.finalize();
  }

  // ── Response Mapping (Gemini API format) ─────────────────────────────────────

  mapToLLMResponse(response: any): LLMResponse {
    GeminiErrorHandler.handleResponseError(response);

    const parts = response.candidates?.[0]?.content?.parts || [];
    let text = '';
    let thoughts = '';
    const toolCalls: LLMToolCall[] = [];
    const fullParts: Part[] = [];

    const sharedSignature = parts.find((p: any) => p.thoughtSignature || p.thought_signature)
      ? ((parts.find((p: any) => p.thoughtSignature || p.thought_signature) as any).thoughtSignature ||
         (parts.find((p: any) => p.thoughtSignature || p.thought_signature) as any).thought_signature)
      : undefined;

    for (const part of parts) {
      const partSig = (part as any).thoughtSignature || (part as any).thought_signature;
      const sig = partSig || sharedSignature;

      if ('functionCall' in part && part.functionCall) {
        const toolCall: LLMToolCall = {
          id: (part.functionCall as any).id || 'call_' + Math.random().toString(36).substring(7),
          name: part.functionCall.name,
          args: part.functionCall.args,
          metadata: sig ? { thought_signature: sig } : undefined,
          thought_signature: sig,
        };
        toolCalls.push(toolCall);
        fullParts.push({ ...part, functionCall: { ...part.functionCall, id: toolCall.id }, thought_signature: sig });
      } else if ('thought' in part && part.thought) {
        const thoughtText = typeof part.thought === 'string' ? part.thought : (part as any).text || '';
        if (thoughtText) thoughts += thoughtText;
        fullParts.push({ ...part, thought_signature: sig } as any);
      } else if ('text' in part && part.text) {
        text += part.text;
        fullParts.push({ ...part, thought_signature: sig } as any);
      }
    }

    return {
      text,
      thoughts: thoughts || undefined,
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

  // ── Content Mapping (LLMMessage → GenAI format) ──────────────────────────────

  private mapToGenAIContent(msg: LLMMessage): any {
    const role = msg.role === 'model' ? 'model' : 'user';

    return {
      role,
      parts: typeof msg.content === 'string'
        ? [{ text: msg.content }]
        : (msg.content as any[]).map((p) => {
          const rawSig = p.thought_signature || p.thoughtSignature;
          const sig = rawSig ? ensureBase64(rawSig) : undefined;

          if (p.thought) {
            if (p.thought === true && p.text) return { text: p.text, thought: true, ...(sig && { thoughtSignature: sig }) };
            return { thought: p.thought, ...(sig && { thoughtSignature: sig }) };
          }
          if (p.functionCall) {
            return { functionCall: { name: p.functionCall.name, args: p.functionCall.args }, ...(sig && { thoughtSignature: sig }) };
          }
          if (p.functionResponse) {
            return { functionResponse: { name: p.functionResponse.name, response: p.functionResponse.response }, ...(sig && { thoughtSignature: sig }) };
          }
          if (p.inlineData) {
            return { inlineData: { mimeType: p.inlineData.mimeType, data: p.inlineData.data } };
          }
          if (p.text) return { text: p.text };
          return { text: '' };
        }).filter((p: any) => {
          if (p.text === '' && Object.keys(p).length === 1) return false;
          return (p.text !== undefined || p.thought !== undefined || p.functionCall !== undefined || p.functionResponse !== undefined || p.inlineData !== undefined);
        }),
    };
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function ensureBase64(str: string): string {
  if (!str) return '';
  const base64Regex = /^[A-Za-z0-9+/_-]+=*$/;
  if (base64Regex.test(str)) return str;
  try {
    return Buffer.from(str).toString('base64');
  } catch {
    return str;
  }
}
