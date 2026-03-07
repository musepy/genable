/**
 * @file responseAccumulator.ts
 * @description Accumulates streaming LLM response chunks into a single LLMResponse.
 * Provider-agnostic — operates on the common LLMResponse/LLMToolCall/Part types.
 */

import { LLMResponse, LLMToolCall, Part } from '../types';

/**
 * Accumulates streaming response chunks (text, thoughts, tool calls, fullParts).
 *
 * Handles the case where thoughtSignature arrives in a different streaming
 * chunk than the functionCall it belongs to (common with Gemini 3).
 * Providers that don't use signatures get a simple passthrough.
 */
export class ResponseAccumulator {
  private text: string = '';
  private thoughts: string = '';
  private toolCalls: LLMToolCall[] = [];
  private fullParts: Part[] = [];
  private usage?: LLMResponse['usage'];

  append(chunk: LLMResponse): void {
    if (chunk.text) this.text += chunk.text;
    if (chunk.thoughts) this.thoughts += chunk.thoughts;
    if (chunk.toolCalls && chunk.toolCalls.length > 0) this.toolCalls.push(...chunk.toolCalls);
    if (chunk.fullParts && chunk.fullParts.length > 0) this.fullParts.push(...chunk.fullParts);
    if (chunk.usage) this.usage = chunk.usage;
  }

  finalize(): LLMResponse {
    // Identify shared signature across accumulated parts (if any)
    const sharedSignature = (this.fullParts as any[]).find((p: any) => p.thought_signature || p.thoughtSignature)?.thought_signature
      || (this.fullParts as any[]).find((p: any) => p.thought_signature || p.thoughtSignature)?.thoughtSignature;

    const finalFullParts: Part[] = [];

    if (sharedSignature) {
      // Propagate signature to tool calls missing it
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

      // Propagate signature to parts, filter out standalone signature-only parts
      for (const p of this.fullParts as any[]) {
        if (p.text || p.thought || p.functionCall || p.functionResponse) {
          const copy = { ...p };
          if (!copy.thought_signature) copy.thought_signature = sharedSignature;
          finalFullParts.push(copy);
        }
      }
    } else {
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
      usage: this.usage,
    };
  }

  getText(): string { return this.text; }
  getThoughts(): string { return this.thoughts; }
  getToolCalls(): LLMToolCall[] { return this.toolCalls; }
}
