/**
 * @file openrouter.ts
 * @description OpenRouter LLM Provider implementation using OpenAI-compatible REST API.
 */

import { LLMProvider, LLMGenerateOptions, LLMResponse, LLMMessage, LLMToolResult, formatResponseDefault, formatToolResultsDefault, getToolSystemInstructionDefault } from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { OPENROUTER_CONFIG } from '../config';
import { resolveMaxOutput } from '../modelCaps';
import { mapMessagesToOpenAI, mapOpenAIToLLMResponse } from './shared/openaiFormat';
import {
  APIError,
  TransportError,
  EmptyResponseError,
} from './shared/providerErrors';

export class OpenRouterProvider implements LLMProvider {
  public readonly name = 'openrouter';

  constructor(private apiKey: string, private modelName: string = OPENROUTER_CONFIG.DEFAULT_MODEL) {}

  getCapabilities() {
    return {
      supportsTextStreaming: false,
      supportsReasoningStreaming: false,
      supportsVision: true,
      contextWindow: 1_000_000,
    };
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature, maxTokens, responseSchema, toolConfig, models, abortSignal } = options;

    // System prompt → first message (OpenAI format)
    const openAIMessages = mapMessagesToOpenAI(messages);
    if (options.system) {
      openAIMessages.unshift({ role: 'system', content: options.system });
    }

    const body: any = {
      messages: openAIMessages,
      temperature: temperature ?? 0.7,
      max_tokens: resolveMaxOutput(this.modelName, maxTokens),
    };

    // OpenRouter supports 'models' array for fallback or 'model' string
    if (models && models.length > 0) {
      body.models = models;
    } else {
      body.model = this.modelName;
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));

      const mode = toolConfig?.mode || 'AUTO';
      if (mode === 'ANY') {
        body.tool_choice = 'required';
      } else if (mode === 'NONE') {
        body.tool_choice = 'none';
      } else {
        body.tool_choice = 'auto';
      }
    }

    if (responseSchema && !tools) {
      body.response_format = { type: 'json_object' };
    }

    let response: Response;
    try {
      response = await fetch(`${OPENROUTER_CONFIG.BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': OPENROUTER_CONFIG.SITE_URL,
          'X-Title': OPENROUTER_CONFIG.SITE_NAME,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new TransportError(this.name, 'Aborted', e);
      throw new TransportError(this.name, e?.message || 'fetch failed', e);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new APIError(this.name, response.status, errText);
    }

    const data = await response.json();
    const mapped = mapOpenAIToLLMResponse(data);
    // OpenRouter returns LLMResponse-shaped object — narrow to typed shape
    const result: LLMResponse = mapped as LLMResponse;
    const hasText = !!result.text && result.text.length > 0;
    const hasToolCalls = !!result.toolCalls && result.toolCalls.length > 0;
    if (!hasText && !hasToolCalls) {
      throw new EmptyResponseError(this.name);
    }
    return result;
  }

  getToolSystemInstruction(tools: ToolDefinition[]): string {
    return getToolSystemInstructionDefault(tools);
  }

  formatResponse(response: LLMResponse): LLMMessage {
    return formatResponseDefault(response);
  }

  formatToolResults(results: LLMToolResult[]): LLMMessage {
    return formatToolResultsDefault(results);
  }
}
