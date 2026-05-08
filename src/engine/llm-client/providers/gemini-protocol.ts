/**
 * @file gemini-protocol.ts
 * @description Generic Gemini protocol provider. Replaces the per-vendor
 * gemini.ts handler with a single dispatcher keyed off
 * ProviderConfig.protocol === 'gemini'.
 *
 * Absorbed: gemini.ts (AI Studio path via @google/genai SDK).
 *
 * Dropped:
 *   - Vertex AI path (gemini.ts:24-32 — accessToken + vertexProject +
 *     vertexLocation constructor branch). Out of scope for this refactor;
 *     to re-add, expose those fields on ProviderConfig (or a Vertex-specific
 *     preset) and pass `vertexai: true` + `httpOptions.headers.Authorization`
 *     to GoogleGenAI like the original code did.
 *
 * Notes:
 *   - config.baseURL is INFORMATIONAL ONLY for this protocol. The
 *     `@google/genai` SDK manages its own internal endpoint and does not
 *     accept a custom base URL through a clean public API. Presets can still
 *     record a baseURL for documentation/UI display.
 *   - config.headers is also IGNORED — the SDK does not expose a clean way to
 *     add custom request headers per-call. Vendor-specific routing via
 *     headers must use the openai-protocol or anthropic-protocol path.
 */

import { GoogleGenAI } from '@google/genai';
import type { ProviderConfig } from '../../../types/provider';
import {
  LLMProvider,
  LLMGenerateOptions,
  LLMResponse,
  LLMMessage,
  LLMToolResult,
  LLMProviderCapabilities,
  getToolSystemInstructionDefault,
} from './types';
import type { ToolDefinition } from '../../agent/tools/types';
import { GeminiErrorHandler } from './gemini/geminiErrorHandler';
import {
  mapGeminiPartsToLLMResponse,
  mapLLMMessageToGeminiContent,
  buildGeminiGenerationConfig,
  buildGeminiToolsPayload,
  formatResponseGemini,
  formatToolResultsGemini,
} from './gemini/geminiFormat';
import { GeminiLogger } from './gemini/geminiLogger';
import { ResponseAccumulator } from './shared/responseAccumulator';
import { consumeStream, withConnectTimeout } from './shared/streamHandler';
import { EmptyResponseError } from './shared/providerErrors';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Connect timeout: max time to establish the streaming connection (ms). */
const CONNECT_TIMEOUT_MS = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export class GeminiProtocolProvider implements LLMProvider {
  public readonly name = 'gemini-protocol';
  private readonly client: any;

  constructor(private readonly config: ProviderConfig) {
    if (!config.modelId) {
      throw new Error('[gemini-protocol] ProviderConfig.modelId is required');
    }
    if (!config.apiKey) {
      throw new Error('[gemini-protocol] ProviderConfig.apiKey is required');
    }

    if (config.headers && Object.keys(config.headers).length > 0) {
      // The SDK does not expose a clean way to inject custom headers per call.
      // We log + ignore rather than silently dropping. If a vendor needs
      // routing via headers, they should use openai-protocol or
      // anthropic-protocol against an OpenAI/Anthropic-compatible endpoint.
      GeminiLogger.warn(
        `gemini-protocol ignoring config.headers (${Object.keys(config.headers).join(', ')}); ` +
          `the @google/genai SDK does not support custom per-call headers.`,
      );
    }

    // AI Studio path: api key only. Vertex AI path is intentionally dropped
    // (see file header). config.baseURL is informational — the SDK manages
    // its own internal endpoint.
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  getCapabilities(): LLMProviderCapabilities {
    return {
      supportsTextStreaming: true,
      supportsReasoningStreaming: true,
      supportsVision: true,
      contextWindow: 1_000_000,
    };
  }

  // ── LLMProvider surface ────────────────────────────────────────────────────

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const {
      messages, tools, temperature, maxTokens, thinkingLevel, responseSchema,
      toolConfig, onProgress, onThinking, abortSignal,
    } = options;

    GeminiLogger.info(
      `generate() called, tools=${tools?.length || 0}, toolConfig=${JSON.stringify(toolConfig)}`,
    );

    const config = this.buildConfig({
      system: options.system, tools, temperature, maxTokens,
      thinkingLevel, responseSchema, toolConfig,
    });
    const contents = messages.map((m) => mapLLMMessageToGeminiContent(m));

    if (onProgress || onThinking) {
      return this.generateStreaming(contents, config, onProgress, onThinking, abortSignal);
    }

    let response: any;
    try {
      response = await this.client.models.generateContent({
        model: this.config.modelId, contents, config,
      });
    } catch (error: any) {
      GeminiErrorHandler.handleSdkError(error);
    }
    return this.assertNonEmpty(this.mapToLLMResponse(response));
  }

  async *generateStream(options: LLMGenerateOptions): AsyncIterable<LLMResponse> {
    // Same shape the old gemini.ts exposed: aggregate via callbacks, yield once.
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

  // ── Config building ────────────────────────────────────────────────────────

  private buildConfig(opts: {
    system?: string;
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    thinkingLevel?: string;
    responseSchema?: Record<string, any>;
    toolConfig?: LLMGenerateOptions['toolConfig'];
  }): any {
    const { system, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig } = opts;

    const config: any = {
      ...buildGeminiGenerationConfig({
        modelName: this.config.modelId!,
        temperature, maxTokens, thinkingLevel, responseSchema,
        hasTools: !!(tools && tools.length > 0),
      }),
    };

    if (system) {
      config.systemInstruction = system;
    }

    const toolsResult = buildGeminiToolsPayload(tools, toolConfig);
    if (toolsResult) {
      config.tools = toolsResult.tools;
      config.toolConfig = toolsResult.toolConfig;
    }

    return config;
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

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
        () => this.client.models.generateContentStream({
          model: this.config.modelId, contents, config,
        }),
        CONNECT_TIMEOUT_MS,
      );
    } catch (error: any) {
      GeminiErrorHandler.handleSdkError(error);
      throw error; // unreachable, but satisfies TS control flow
    }

    const accumulator = new ResponseAccumulator();
    let streamAborted = false;

    try {
      const { aborted } = await consumeStream(
        stream,
        (response: any) => {
          const mapped = this.mapToLLMResponse(response);
          if (mapped.text) onProgress?.(mapped.text);
          if (mapped.thoughts) onThinking?.(mapped.thoughts);
          accumulator.append(mapped);
        },
        { abortSignal },
      );
      streamAborted = aborted;
    } catch (streamError: any) {
      // SDK SSE truncation — retain whatever was accumulated, then fall through
      // to validation/empty-response checks. If nothing usable, assertNonEmpty
      // will throw. (Ported from gemini.ts:159-167.)
      if (streamError?.message?.includes('Incomplete JSON segment')) {
        GeminiLogger.warn(
          `Stream truncated (SDK SSE buffer not empty). Accumulated: ` +
            `${accumulator.getText().length} chars text, ` +
            `${accumulator.getToolCalls().length} tool calls`,
        );
      } else {
        GeminiErrorHandler.handleSdkError(streamError);
      }
    }

    if (!streamAborted) {
      GeminiErrorHandler.validateResponseContent(
        accumulator.getText(),
        accumulator.getToolCalls(),
        accumulator.getThoughts(),
      );
    }

    return this.assertNonEmpty(accumulator.finalize());
  }

  // ── Response mapping ───────────────────────────────────────────────────────

  private mapToLLMResponse(response: any): LLMResponse {
    GeminiErrorHandler.handleResponseError(response);
    const parts = response.candidates?.[0]?.content?.parts || [];
    return mapGeminiPartsToLLMResponse(parts, response.usageMetadata);
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
}
