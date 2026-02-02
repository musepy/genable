/**
 * @file geminiResponseAccumulator.ts
 * @description Centralized logic for accumulating streaming Gemini response chunks.
 */

import { LLMResponse, LLMToolCall, Part } from '../types';

/**
 * Accumulator for Gemini response chunks.
 * Ensures text, thoughts, tool calls, and full parts are correctly merged.
 */
export class GeminiResponseAccumulator {
  private text: string = '';
  private thoughts: string = '';
  private toolCalls: LLMToolCall[] = [];
  private fullParts: Part[] = [];
  private usage?: LLMResponse['usage'];

  /**
   * Appends a new response chunk to the accumulated state.
   */
  append(chunk: LLMResponse): void {
    if (chunk.text) {
      this.text += chunk.text;
    }

    if (chunk.thoughts) {
      this.thoughts += chunk.thoughts;
    }

    if (chunk.toolCalls && chunk.toolCalls.length > 0) {
      this.toolCalls.push(...chunk.toolCalls);
    }

    if (chunk.fullParts && chunk.fullParts.length > 0) {
      this.fullParts.push(...chunk.fullParts);
    }

    // Always keep the latest usage if provided
    if (chunk.usage) {
      this.usage = chunk.usage;
    }
  }

  /**
   * Returns the final accumulated response.
   */
  finalize(): LLMResponse {
    return {
      text: this.text,
      thoughts: this.thoughts || undefined,
      toolCalls: this.toolCalls.length > 0 ? this.toolCalls : undefined,
      fullParts: this.fullParts.length > 0 ? this.fullParts : undefined,
      usage: this.usage
    };
  }

  /**
   * Getters for current state (useful for streaming callbacks)
   */
  getText(): string { return this.text; }
  getThoughts(): string { return this.thoughts; }
  getToolCalls(): LLMToolCall[] { return this.toolCalls; }
}
