/**
 * @file responseAccumulator.ts
 * @description Accumulates streaming LLM response chunks into a single LLMResponse.
 * Provider-agnostic — operates on the common LLMResponse/ToolCallBlock/ContentBlock types.
 */

import { LLMResponse, ToolCallBlock, ContentBlock, FinishReason } from '../types';

/**
 * Accumulates streaming response chunks (text, thoughts, tool calls, fullBlocks).
 *
 * Handles the case where thoughtSignature arrives in a different streaming
 * chunk than the tool_call it belongs to (common with Gemini 3).
 * Providers that don't use signatures get a simple passthrough.
 */
export class ResponseAccumulator {
  private text: string = '';
  private thoughts: string = '';
  private toolCalls: ToolCallBlock[] = [];
  private fullBlocks: ContentBlock[] = [];
  private usage?: LLMResponse['usage'];
  private finishReason?: FinishReason;

  append(chunk: LLMResponse): void {
    if (chunk.text) this.text += chunk.text;
    if (chunk.thoughts) this.thoughts += chunk.thoughts;
    if (chunk.toolCalls && chunk.toolCalls.length > 0) this.toolCalls.push(...chunk.toolCalls);
    if (chunk.fullBlocks && chunk.fullBlocks.length > 0) this.fullBlocks.push(...chunk.fullBlocks);
    if (chunk.usage) this.usage = chunk.usage;
    if (chunk.finishReason) this.finishReason = chunk.finishReason;
  }

  finalize(): LLMResponse {
    // Identify shared signature across accumulated blocks (if any)
    const sharedSignature = this.fullBlocks.find((b) => {
      if (b.type === 'tool_call' || b.type === 'tool_result') return !!b.thoughtSignature;
      if (b.type === 'thinking') return !!b.signature;
      return false;
    });
    const sharedSig = sharedSignature
      ? (sharedSignature.type === 'thinking' ? sharedSignature.signature : (sharedSignature as any).thoughtSignature)
      : undefined;

    const finalBlocks: ContentBlock[] = [];

    if (sharedSig) {
      // Propagate signature to tool calls missing it
      for (const tc of this.toolCalls) {
        if (!tc.thoughtSignature) {
          tc.thoughtSignature = sharedSig;
        }
      }

      // Propagate signature to blocks, filter out empty blocks
      for (const b of this.fullBlocks) {
        if (b.type === 'text' || b.type === 'thinking' || b.type === 'tool_call' || b.type === 'tool_result') {
          if (b.type === 'tool_call' && !b.thoughtSignature) {
            finalBlocks.push({ ...b, thoughtSignature: sharedSig });
          } else if (b.type === 'tool_result' && !b.thoughtSignature) {
            finalBlocks.push({ ...b, thoughtSignature: sharedSig });
          } else if (b.type === 'thinking' && !b.signature) {
            finalBlocks.push({ ...b, signature: sharedSig });
          } else {
            finalBlocks.push(b);
          }
        }
      }
    } else {
      for (const b of this.fullBlocks) {
        if (b.type === 'text' || b.type === 'thinking' || b.type === 'tool_call' || b.type === 'tool_result') {
          finalBlocks.push(b);
        }
      }
    }

    return {
      text: this.text,
      thoughts: this.thoughts || undefined,
      toolCalls: this.toolCalls.length > 0 ? this.toolCalls : undefined,
      fullBlocks: finalBlocks.length > 0 ? finalBlocks : undefined,
      usage: this.usage,
      finishReason: this.finishReason,
    };
  }

  getText(): string { return this.text; }
  getThoughts(): string { return this.thoughts; }
  getToolCalls(): ToolCallBlock[] { return this.toolCalls; }
}
