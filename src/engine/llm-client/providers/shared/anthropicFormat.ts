/**
 * @file anthropicFormat.ts
 * @description Shared Anthropic Messages API wire format conversions.
 *
 * Mirrors the structure of openaiFormat.ts so the protocol-based providers can
 * stay self-describing. Used by anthropic-protocol.ts and any future
 * Anthropic-compatible vendor (DashScope-anthropic, OpenCode Zen, …).
 *
 * Ported from anthropic.ts L42-185 — same behavior, decoupled from the
 * vendor-specific HTTP/auth layer.
 */

import type { LLMMessage, LLMResponse, ToolCallBlock, ImageBlock, ContentBlock, ThinkingBlock } from '../types';
import { normalizeFinishReason } from '../types';

// ═══════════════════════════════════════════════════════════════
// Request direction: LLMMessage[] → Anthropic Messages API
// ═══════════════════════════════════════════════════════════════

/**
 * Convert our LLMMessage[] to Anthropic /messages content blocks.
 *
 * Behavior preserved from anthropic.ts:46-149:
 * - tool result + trailing image blocks coalesce into a single tool_result
 *   with multimodal content (used by inspect screenshots).
 * - assistant content is rebuilt block-by-block to map text/tool_call.
 * - Anthropic requires alternating user/assistant turns; consecutive same-role
 *   messages are merged.
 */
export function mapMessagesToAnthropic(messages: LLMMessage[]): any[] {
  const mapped: any[] = [];

  for (const m of messages) {
    // Tool results → user message with tool_result content blocks.
    // Image blocks immediately following a tool_result are attached as
    // multimodal content inside the same tool_result (screenshot from inspect).
    if (m.role === 'tool' && Array.isArray(m.content)) {
      const blocks = m.content;
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.type === 'tool_result') {
          const resultContent: any[] = [{ type: 'text', text: JSON.stringify(block.data) }];
          while (i + 1 < blocks.length && blocks[i + 1].type === 'image') {
            i++;
            const img = blocks[i] as ImageBlock;
            resultContent.push({
              type: 'image',
              source: { type: 'base64', media_type: img.mimeType, data: img.data },
            });
          }
          mapped.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: block.id || 'unknown',
              content: resultContent,
              ...(block.isError === true && { is_error: true }),
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
          if (block.type === 'thinking') {
            // Claude requires thinking blocks to come first in assistant content
            // and to carry the original `signature` echoed back verbatim. Blocks
            // without a signature (e.g. synthesized from a non-Claude provider's
            // history) are dropped — Claude would reject the turn otherwise.
            if (block.signature) {
              content.push({ type: 'thinking', thinking: block.text, signature: block.signature });
            }
          }
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

  // Anthropic requires strictly alternating user/assistant turns.
  // Merge consecutive same-role messages (anthropic.ts:135-146).
  const merged: any[] = [];
  for (const msg of mapped) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      const prevContent = Array.isArray(prev.content)
        ? prev.content
        : [{ type: 'text', text: prev.content }];
      const curContent = Array.isArray(msg.content)
        ? msg.content
        : [{ type: 'text', text: msg.content }];
      prev.content = [...prevContent, ...curContent];
    } else {
      merged.push(msg);
    }
  }

  return merged;
}

// ═══════════════════════════════════════════════════════════════
// Response direction: Anthropic response → LLMResponse
// ═══════════════════════════════════════════════════════════════

/**
 * Convert an Anthropic /messages response to our LLMResponse.
 *
 * Stop-reason mapping is delegated to normalizeFinishReason (types.ts:90),
 * which already understands Anthropic's aliases:
 *   end_turn   → stop
 *   max_tokens → length
 *   tool_use   → tool_calls
 *
 * Ported from anthropic.ts:155-185.
 */
export function mapAnthropicToLLMResponse(data: any): LLMResponse {
  const textParts: string[] = [];
  const thoughtParts: string[] = [];
  const toolCalls: ToolCallBlock[] = [];
  const fullBlocks: ContentBlock[] = [];

  for (const block of data.content || []) {
    if (block.type === 'thinking') {
      // Claude extended-thinking block. `thinking` holds the chain-of-thought
      // text; `signature` is an opaque token Claude requires us to echo back
      // verbatim on subsequent assistant turns (see mapMessagesToAnthropic).
      const text = block.thinking || '';
      thoughtParts.push(text);
      fullBlocks.push({ type: 'thinking', text, signature: block.signature });
    } else if (block.type === 'text') {
      textParts.push(block.text);
      fullBlocks.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      const tc: ToolCallBlock = {
        type: 'tool_call' as const,
        id: block.id,
        name: block.name,
        input: block.input,
      };
      toolCalls.push(tc);
      fullBlocks.push(tc);
    }
  }

  return {
    text: textParts.join(''),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    thoughts: thoughtParts.length > 0 ? thoughtParts.join('') : undefined,
    fullBlocks: fullBlocks.length > 0 ? fullBlocks : undefined,
    finishReason: normalizeFinishReason(data.stop_reason),
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens || 0,
      completionTokens: data.usage.output_tokens || 0,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      cachedTokens: data.usage.cache_read_input_tokens || undefined,
    } : undefined,
  };
}
