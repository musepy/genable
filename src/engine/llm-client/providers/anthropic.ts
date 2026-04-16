/**
 * @file anthropic.ts
 * @description Anthropic Claude LLM Provider implementation using the Messages API.
 *
 * Anthropic has its own wire format (not OpenAI-compatible), so this provider
 * handles format conversion directly rather than using shared/openaiFormat.ts.
 */

import {
  LLMProvider, LLMGenerateOptions, LLMResponse, LLMMessage, LLMToolResult,
  formatResponseDefault, formatToolResultsDefault, getToolSystemInstructionDefault,
  ContentBlock, normalizeFinishReason,
} from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { ANTHROPIC_CONFIG } from '../config';
import {
  APIError,
  TransportError,
  EmptyResponseError,
} from './shared/providerErrors';

// ═══════════════════════════════════════════════════════════════
// Wire format: LLMMessage[] → Anthropic Messages API
// ═══════════════════════════════════════════════════════════════

function mapMessagesToAnthropic(messages: LLMMessage[]): { system?: string; messages: any[] } {
  let system: string | undefined;
  const mapped: any[] = [];

  for (const m of messages) {
    // System messages → top-level system parameter
    if (m.role === 'system') {
      const text = typeof m.content === 'string'
        ? m.content
        : (m.content as ContentBlock[]).filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
      system = system ? `${system}\n\n${text}` : text;
      continue;
    }

    // Tool results → user message with tool_result content blocks
    if (m.role === 'tool' && Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === 'tool_result') {
          mapped.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: block.id || 'unknown',
              content: JSON.stringify(block.data),
            }],
          });
        }
      }
      continue;
    }

    // Model → assistant
    if (m.role === 'model') {
      const content: any[] = [];

      if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === 'text') {
            content.push({ type: 'text', text: block.text });
          }
          if (block.type === 'tool_call') {
            content.push({
              type: 'tool_use',
              id: block.id || 'toolu_' + Math.random().toString(36).substring(7),
              name: block.name,
              input: block.input,
            });
          }
        }
      } else if (typeof m.content === 'string' && m.content) {
        content.push({ type: 'text', text: m.content });
      }

      if (content.length > 0) {
        mapped.push({ role: 'assistant', content });
      }
      continue;
    }

    // User messages
    if (m.role === 'user') {
      if (Array.isArray(m.content)) {
        const content: any[] = [];
        for (const block of m.content) {
          if (block.type === 'text') content.push({ type: 'text', text: block.text });
          if (block.type === 'image') {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: block.mimeType,
                data: block.data,
              },
            });
          }
        }
        if (content.length > 0) mapped.push({ role: 'user', content });
      } else if (typeof m.content === 'string' && m.content) {
        mapped.push({ role: 'user', content: m.content });
      }
    }
  }

  // Anthropic requires alternating user/assistant turns.
  // Merge consecutive same-role messages.
  const merged: any[] = [];
  for (const msg of mapped) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      // Merge content
      const prevContent = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: prev.content }];
      const curContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
      prev.content = [...prevContent, ...curContent];
    } else {
      merged.push(msg);
    }
  }

  return { system, messages: merged };
}

// ═══════════════════════════════════════════════════════════════
// Wire format: Anthropic response → LLMResponse
// ═══════════════════════════════════════════════════════════════

function mapAnthropicToLLMResponse(data: any): LLMResponse {
  const textParts: string[] = [];
  const toolCalls: { id: string; name: string; args: any }[] = [];

  for (const block of data.content || []) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        args: block.input,
      });
    }
  }

  return {
    text: textParts.join(''),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    // Anthropic stop_reason aliases handled by normalizeFinishReason:
    // end_turn → stop, max_tokens → length, tool_use → tool_calls
    finishReason: normalizeFinishReason(data.stop_reason),
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens || 0,
      completionTokens: data.usage.output_tokens || 0,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      cachedTokens: data.usage.cache_read_input_tokens || undefined,
    } : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════════════════════════

export class AnthropicProvider implements LLMProvider {
  public readonly name = 'claude';
  private baseUrl: string;

  constructor(
    private apiKey: string,
    private modelName: string = ANTHROPIC_CONFIG.DEFAULT_MODEL,
    baseUrl?: string,
  ) {
    this.baseUrl = baseUrl || ANTHROPIC_CONFIG.BASE_URL;
  }

  getCapabilities() {
    return {
      supportsTextStreaming: false,
      supportsReasoningStreaming: false,
      contextWindow: 200_000,
    };
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature, maxTokens, toolConfig, abortSignal } = options;

    const { system, messages: anthropicMessages } = mapMessagesToAnthropic(messages);

    const body: any = {
      model: this.modelName,
      max_tokens: maxTokens || 8192,
      messages: anthropicMessages,
    };

    if (system) body.system = system;
    if (temperature !== undefined) body.temperature = temperature;

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));

      const mode = toolConfig?.mode || 'AUTO';
      if (mode === 'ANY') {
        body.tool_choice = { type: 'any' };
      } else if (mode === 'NONE') {
        // Anthropic doesn't have a 'none' tool_choice — just omit tools
        delete body.tools;
      } else {
        body.tool_choice = { type: 'auto' };
      }
    }

    const isNativeAnthropic = this.baseUrl === ANTHROPIC_CONFIG.BASE_URL;
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'content-type': 'application/json',
    };
    // Native Anthropic requires version header + browser access flag
    // DashScope-compatible endpoints don't need these
    if (isNativeAnthropic) {
      headers['anthropic-version'] = ANTHROPIC_CONFIG.API_VERSION;
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
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
    const mapped = mapAnthropicToLLMResponse(data);
    const hasText = !!mapped.text && mapped.text.length > 0;
    const hasToolCalls = !!mapped.toolCalls && mapped.toolCalls.length > 0;
    if (!hasText && !hasToolCalls) {
      throw new EmptyResponseError(this.name);
    }
    return mapped;
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
