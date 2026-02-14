/**
 * @file geminiResponseAccumulator.ts
 * @description Centralized logic for accumulating streaming Gemini response chunks.
 */

import { LLMResponse, LLMToolCall, Part } from '../types';

/**
 * Accumulator for Gemini response chunks.
 * Ensures text, thoughts, tool calls, and full parts are correctly merged.
 *
 * Handles the case where thoughtSignature arrives in a different streaming
 * chunk than the functionCall it belongs to (common with Gemini 3).
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
    // 1. Identify shared signature in the accumulated parts
    const sharedSignature = (this.fullParts as any[]).find((p: any) => p.thought_signature || p.thoughtSignature)?.thought_signature 
      || (this.fullParts as any[]).find((p: any) => p.thought_signature || p.thoughtSignature)?.thoughtSignature;

    const finalFullParts: Part[] = [];

    // 2. Propagate signature and filter out standalone signature parts
    if (sharedSignature) {
      // Update accumulated toolCalls
      for (const tc of this.toolCalls) {
        if (!tc.thought_signature) {
          tc.thought_signature = sharedSignature;
          if (tc.metadata) {
            tc.metadata.thought_signature = sharedSignature;
          } else {
            tc.metadata = { thought_signature: sharedSignature };
          }
        }
      }

      // Process fullParts to ensure no standalone signature parts AND propagate signature
      for (const p of this.fullParts as any[]) {
        if (p.text || p.thought || p.functionCall || p.functionResponse) {
          // Propagate signature to each part in history
          const copy = { ...p };
          if (!copy.thought_signature) {
            copy.thought_signature = sharedSignature;
          }
          finalFullParts.push(copy);
        }
      }
    } else {
      // No signature found, just keep everything as is (filtering out any accidental standalone empty parts)
      for (const p of this.fullParts as any[]) {
         if (p.text || p.thought || p.functionCall || p.functionResponse) {
            finalFullParts.push(p);
         }
      }
    }

    return {
      text: this.text,
      thoughts: this.thoughts || undefined,
      toolCalls: this.toolCalls.length > 0 ? this.toolCalls : undefined,
      fullParts: finalFullParts.length > 0 ? finalFullParts : undefined,
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
