/**
 * @file openaiFormat.ts
 * @description Shared OpenAI-compatible wire format conversions.
 *
 * Used by OpenRouter, DashScope, and any future OpenAI-compatible provider.
 * Eliminates ~110 lines of duplicated mapMessages/mapToLLMResponse code per provider.
 */

import type { LLMMessage, LLMToolCall, Part, FinishReason } from '../types';
import { normalizeFinishReason } from '../types';

// ═══════════════════════════════════════════════════════════════
// Request direction: LLMMessage[] → OpenAI messages
// ═══════════════════════════════════════════════════════════════

/**
 * Convert our LLMMessage[] to OpenAI chat/completions message format.
 * Handles role mapping (model→assistant), tool result flattening, and tool call encoding.
 */
export function mapMessagesToOpenAI(messages: LLMMessage[]): any[] {
  const mapped: any[] = [];

  for (const m of messages) {
    let role: string = m.role;
    if (role === 'model') role = 'assistant';

    // Tool results → individual messages per OpenAI spec
    if (m.role === 'tool' && Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.functionResponse) {
          mapped.push({
            role: 'tool',
            tool_call_id: part.tool_call_id || 'unknown',
            content: JSON.stringify(part.functionResponse.response),
          });
        }
      }
      continue;
    }

    let content: any = m.content;
    if (Array.isArray(m.content)) {
      content = m.content.map((p: Part) => {
        if (p.text) return { type: 'text', text: p.text };
        if (p.inlineData) return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
        return null;
      }).filter(Boolean);
      if (content.length === 1 && content[0].type === 'text') content = content[0].text;
      else if (content.length === 0) content = null;
    }

    const msg: any = { role, content };

    // Assistant tool calls
    if (m.role === 'model' && Array.isArray(m.content)) {
      const tcs = m.content
        .filter((p: Part) => p.functionCall)
        .map((p: Part) => ({
          id: p.tool_call_id || 'call_' + Math.random().toString(36).substring(7),
          type: 'function',
          function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args) },
        }));
      if (tcs.length > 0) {
        msg.tool_calls = tcs;
        if (!msg.content) msg.content = null;
      }
    }

    mapped.push(msg);
  }

  return mapped;
}

// ═══════════════════════════════════════════════════════════════
// Response direction: OpenAI response → LLMResponse
// ═══════════════════════════════════════════════════════════════

/**
 * Convert OpenAI chat/completions response to our LLMResponse.
 * Handles tool call parsing and usage extraction.
 */
export function mapOpenAIToLLMResponse(data: any): {
  text: string;
  toolCalls?: LLMToolCall[];
  finishReason?: FinishReason;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
} {
  const choice = data.choices?.[0];
  const message = choice?.message;

  const rawToolCalls: LLMToolCall[] | undefined = message?.tool_calls?.map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
  }));

  return {
    text: message?.content || '',
    toolCalls: rawToolCalls && rawToolCalls.length > 0 ? rawToolCalls : undefined,
    finishReason: normalizeFinishReason(choice?.finish_reason),
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0,
      cachedTokens: data.usage.prompt_tokens_details?.cached_tokens || undefined,
    } : undefined,
  };
}
