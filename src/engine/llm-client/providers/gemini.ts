/**
 * @file gemini.ts
 * @description Gemini LLM Provider — direct SDK access via @google/genai.
 */

import { GoogleGenAI } from '@google/genai';
import { LLMProvider, LLMGenerateOptions, LLMResponse, LLMMessage, Part, LLMToolResult, getToolSystemInstructionDefault } from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { GeminiErrorHandler } from './gemini/geminiErrorHandler';
import { mapGeminiPartsToLLMResponse, mapLLMMessageToGeminiContent, buildGeminiGenerationConfig, buildGeminiToolsPayload } from './gemini/geminiFormat';
import { GeminiLogger } from './gemini/geminiLogger';
import { ResponseAccumulator } from './shared/responseAccumulator';
import { consumeStream, withConnectTimeout } from './shared/streamHandler';

/** Idle timeout: max silence between chunks (ms) */
const STREAM_IDLE_TIMEOUT_MS = 30000;
/** Connect timeout: max time to establish the streaming connection (ms) */
const CONNECT_TIMEOUT_MS = 60000;

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
    return { supportsTextStreaming: true, supportsReasoningStreaming: true, contextWindow: 1_000_000 };
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig, onProgress, onThinking, abortSignal } = options;

    GeminiLogger.info(`generate() called, tools=${tools?.length || 0}, toolConfig=${JSON.stringify(toolConfig)}`);

    const config = this.buildConfig({ messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig });
    const contents = messages.filter(m => m.role !== 'system').map(m => mapLLMMessageToGeminiContent(m));

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

    const config: any = {
      ...buildGeminiGenerationConfig({
        modelName: this.modelName, temperature, maxTokens, thinkingLevel, responseSchema,
        hasTools: !!(tools && tools.length > 0),
      }),
    };

    // System instruction — SDK requires string format
    const systemMessages = messages.filter(m => m.role === 'system');
    if (systemMessages.length > 0) {
      config.systemInstruction = systemMessages
        .map(m => typeof m.content === 'string' ? m.content : (m.content as any[]).map(p => p.text).join('\n'))
        .join('\n\n');
    }

    // Tools + tool config
    const toolsResult = buildGeminiToolsPayload(tools, toolConfig);
    if (toolsResult) {
      config.tools = toolsResult.tools;
      config.toolConfig = toolsResult.toolConfig;
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
    return mapGeminiPartsToLLMResponse(parts, response.usageMetadata);
  }

}
