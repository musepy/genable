/**
 * @file openrouter.ts
 * @description OpenRouter LLM Provider implementation using OpenAI-compatible REST API.
 */

import { LLMProvider, LLMGenerateOptions, LLMResponse, LLMMessage, LLMToolCall, LLMToolResult, formatResponseDefault, formatToolResultsDefault, getToolSystemInstructionDefault } from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { OPENROUTER_CONFIG } from '../config';

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
    const { messages, tools, temperature, maxTokens, responseSchema, toolConfig, onProgress, models, abortSignal } = options;

    const body: any = {
      messages: this.mapMessages(messages),
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
      
      // [FIX] Specific handling for 402 Payment Required (insufficient credits)
      if (response.status === 402) {
          const contextMsg = error.metadata?.provider_name ? ` (Provider: ${error.metadata.provider_name})` : '';
          errorMessage = `Insufficient Credits: ${errorMessage}${contextMsg}. TIP: Try a free model like 'google/gemini-2.0-flash-lite-preview-02-05:free' or top up your balance.`;
      }
      
      throw new Error(`OpenRouter API Error [${errorCode}]: ${errorMessage}${error.metadata && response.status !== 402 ? ` (Context: ${JSON.stringify(error.metadata)})` : ''}`);
    }

    const data = await response.json();
    return this.mapToLLMResponse(data);
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

  private mapMessages(messages: LLMMessage[]): any[] {
    const mapped: any[] = [];

    for (const m of messages) {
      let role: string = m.role;
      if (role === 'model') role = 'assistant';
      
      if (m.role === 'tool' && Array.isArray(m.content)) {
        // Flat map tool results to individual messages as per OpenAI spec
        for (const part of m.content) {
          if (part.functionResponse) {
            mapped.push({
              role: 'tool',
              tool_call_id: part.tool_call_id || 'unknown',
              content: JSON.stringify(part.functionResponse.response)
            });
          }
        }
        continue;
      }

      let content: any = m.content;
      if (Array.isArray(m.content)) {
        content = m.content.map(p => {
          if (p.text) return { type: 'text', text: p.text };
          return null;
        }).filter(Boolean);
        
        // OpenAI-compatible content can be string if it's only text
        if (content.length === 1 && content[0].type === 'text') {
          content = content[0].text;
        } else if (content.length === 0) {
          content = null;
        }
      }

      const openaiMsg: any = { role, content };

      // Handle assistant tool calls
      if (m.role === 'model' && Array.isArray(m.content)) {
          const toolCalls = m.content
            .filter(p => p.functionCall)
            .map(p => ({
                id: p.tool_call_id || 'call_' + Math.random().toString(36).substring(7),
                type: 'function',
                function: {
                    name: p.functionCall!.name,
                    arguments: JSON.stringify(p.functionCall!.args)
                }
            }));
          if (toolCalls.length > 0) {
              openaiMsg.tool_calls = toolCalls;
              if (!openaiMsg.content) openaiMsg.content = null;
          }
      }

      mapped.push(openaiMsg);
    }

    return mapped;
  }

  private mapToLLMResponse(data: any): LLMResponse {
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls: LLMToolCall[] = message?.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    }));

    return {
      text: message?.content || '',
      toolCalls: toolCalls?.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
        cachedTokens: data.usage.prompt_tokens_details?.cached_tokens || undefined,
      } : undefined,
    };
  }
}
