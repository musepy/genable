/**
 * @file openaiFormat.ts
 * @description Shared OpenAI-compatible wire format conversions.
 *
 * Used by OpenRouter, DashScope, and any future OpenAI-compatible provider.
 * Eliminates ~110 lines of duplicated mapMessages/mapToLLMResponse code per provider.
 */

import type { LLMMessage, ToolCallBlock, ContentBlock, FinishReason } from '../types';
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
    // Images collected and emitted as a trailing user message (tool messages are string-only)
    if (m.role === 'tool' && Array.isArray(m.content)) {
      const pendingImages: { mimeType: string; data: string }[] = [];
      for (const block of m.content) {
        if (block.type === 'tool_result') {
          mapped.push({
            role: 'tool',
            tool_call_id: block.id || 'unknown',
            content: JSON.stringify(block.data),
          });
        } else if (block.type === 'image') {
          pendingImages.push({ mimeType: block.mimeType, data: block.data });
        }
      }
      if (pendingImages.length > 0) {
        mapped.push({
          role: 'user',
          content: pendingImages.map(img => ({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
          })),
        });
      }
      continue;
    }

    let content: any = m.content;
    if (Array.isArray(m.content)) {
      content = m.content.map((p: ContentBlock) => {
        if (p.type === 'text') return { type: 'text', text: p.text };
        if (p.type === 'image') return { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } };
        return null;
      }).filter(Boolean);
      if (content.length === 1 && content[0].type === 'text') content = content[0].text;
      else if (content.length === 0) content = null;
    }

    const msg: any = { role, content };

    // Assistant tool calls
    if (m.role === 'model' && Array.isArray(m.content)) {
      const tcs = m.content
        .filter((p: ContentBlock) => p.type === 'tool_call')
        .map((p: ContentBlock) => {
          const tc = p as import('../types').ToolCallBlock;
          return {
            id: tc.id || 'call_' + Math.random().toString(36).substring(7),
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          };
        });
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
  toolCalls?: ToolCallBlock[];
  finishReason?: FinishReason;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
} {
  const choice = data.choices?.[0];
  const message = choice?.message;

  const rawToolCalls: ToolCallBlock[] | undefined = message?.tool_calls?.map((tc: any) => ({
    type: 'tool_call' as const,
    id: tc.id,
    name: tc.function.name,
    input: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
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
