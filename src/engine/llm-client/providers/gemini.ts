/**
 * @file gemini.ts
 * @description Gemini LLM Provider — direct SDK access via @google/genai.
 */

import { GoogleGenAI } from '@google/genai';
import { LLMProvider, LLMGenerateOptions, LLMResponse, LLMMessage, LLMToolResult, getToolSystemInstructionDefault } from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { GeminiErrorHandler } from './gemini/geminiErrorHandler';
import { mapGeminiPartsToLLMResponse, mapLLMMessageToGeminiContent, buildGeminiGenerationConfig, buildGeminiToolsPayload, formatResponseGemini, formatToolResultsGemini } from './gemini/geminiFormat';
import { GeminiLogger } from './gemini/geminiLogger';
import { ResponseAccumulator } from './shared/responseAccumulator';
import { consumeStream, withConnectTimeout } from './shared/streamHandler';
import {
  StreamIdleTimeoutError,
  EmptyResponseError,
} from './shared/providerErrors';

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
    return this.assertNonEmpty(this.mapToLLMResponse(response));
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

  getToolSystemInstruction(tools: ToolDefinition[]): string {
    return getToolSystemInstructionDefault(tools);
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

    let streamTimedOut = false;
    let streamAborted = false;
    try {
      const { timedOut, aborted } = await consumeStream(stream, (response: any) => {
        const mapped = this.mapToLLMResponse(response);
        if (mapped.text) onProgress?.(mapped.text);
        if (mapped.thoughts) onThinking?.(mapped.thoughts);
        accumulator.append(mapped);
      }, { idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS, abortSignal });
      streamTimedOut = timedOut;
      streamAborted = aborted;
    } catch (streamError: any) {
      // SDK SSE truncation — retain whatever was already accumulated, then fall through
      // to validation/empty-response checks. If nothing usable, assertNonEmpty throws.
      if (streamError?.message?.includes('Incomplete JSON segment')) {
        GeminiLogger.warn(`Stream truncated (SDK SSE buffer not empty). Accumulated: ${accumulator.getText().length} chars text, ${accumulator.getToolCalls().length} tool calls`);
      } else {
        GeminiErrorHandler.handleSdkError(streamError);
      }
    }

    if (streamTimedOut) {
      throw new StreamIdleTimeoutError(this.name, STREAM_IDLE_TIMEOUT_MS, accumulator.getText());
    }

    if (!streamAborted) {
      GeminiErrorHandler.validateResponseContent(accumulator.getText(), accumulator.getToolCalls(), accumulator.getThoughts());
    }

    return this.assertNonEmpty(accumulator.finalize());
  }

  // ── Response Mapping (Gemini API format) ─────────────────────────────────────

  mapToLLMResponse(response: any): LLMResponse {
    GeminiErrorHandler.handleResponseError(response);
    const parts = response.candidates?.[0]?.content?.parts || [];
    return mapGeminiPartsToLLMResponse(parts, response.usageMetadata);
  }

}
