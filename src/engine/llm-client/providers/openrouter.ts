/**
 * @file openrouter.ts
 * @description OpenRouter LLM Provider implementation using OpenAI-compatible REST API.
 */

import { LLMProvider, LLMGenerateOptions, LLMResponse, LLMMessage, LLMToolResult, formatResponseDefault, formatToolResultsDefault, getToolSystemInstructionDefault } from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { OPENROUTER_CONFIG } from '../config';
import { mapMessagesToOpenAI, mapOpenAIToLLMResponse } from './shared/openaiFormat';

export class OpenRouterProvider implements LLMProvider {
  public readonly name = 'openrouter';

  constructor(private apiKey: string, private modelName: string = OPENROUTER_CONFIG.DEFAULT_MODEL) {}

  getCapabilities() {
    return {
      supportsTextStreaming: false,
      supportsReasoningStreaming: false,
      contextWindow: 1_000_000,
    };
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature, maxTokens, responseSchema, toolConfig, models, abortSignal } = options;

    const body: any = {
      messages: mapMessagesToOpenAI(messages),
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens,
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

    const response = await fetch(`${OPENROUTER_CONFIG.BASE_URL}/chat/completions`, {
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

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = errorJson.error || {};
      let errorMessage = error.message || response.statusText;
      const errorCode = error.code || response.status;

      if (response.status === 402) {
          const contextMsg = error.metadata?.provider_name ? ` (Provider: ${error.metadata.provider_name})` : '';
          errorMessage = `Insufficient Credits: ${errorMessage}${contextMsg}. TIP: Try a free model like 'google/gemini-2.0-flash-lite-preview-02-05:free' or top up your balance.`;
      }

      throw new Error(`OpenRouter API Error [${errorCode}]: ${errorMessage}${error.metadata && response.status !== 402 ? ` (Context: ${JSON.stringify(error.metadata)})` : ''}`);
    }

    const data = await response.json();
    return mapOpenAIToLLMResponse(data);
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
