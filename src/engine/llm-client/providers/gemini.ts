/**
 * @file gemini.ts
 * @description Gemini LLM Provider implementation using the standard @google/genai SDK.
 */

import { GoogleGenAI } from '@google/genai';
import { LLMProvider, LLMGenerateOptions, LLMResponse, LLMMessage, LLMToolCall, Part, LLMToolResult } from './types';
import { ToolDefinition } from '../../agent/tools/types';
import { isGemini3Model } from '../modelFilter';
import { GEMINI_CONFIG } from '../config';
import { GeminiErrorHandler } from './gemini/geminiErrorHandler';
import { GeminiResponseAccumulator } from './gemini/geminiResponseAccumulator';
import { GeminiLogger } from './gemini/geminiLogger';

export class GeminiProvider implements LLMProvider {
  public readonly name = 'gemini';
  private client: any;

  constructor(private apiKey: string, private modelName: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  /** Default stream timeout: 30 seconds */
  private static readonly DEFAULT_STREAM_TIMEOUT_MS = 30000;

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig, onProgress, onThinking, abortSignal, streamTimeoutMs } = options;

    const isGemini3 = isGemini3Model(this.modelName);
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const effectiveMaxTokens = maxTokens || GEMINI_CONFIG.MAX_OUTPUT_TOKENS;
    
    // [DIAGNOSTIC] Log configuration details for debugging token limit issues
    GeminiLogger.debug('Generate called with config:', {
      modelName: this.modelName,
      isGemini3,
      effectiveMaxTokens,
      providedMaxTokens: maxTokens,
      configMaxTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
      toolsCount: tools?.length || 0,
      toolsNames: tools?.map(t => t.name),
      hasResponseSchema: !!responseSchema,
      messageCount: messages.length,
      promptTokenEstimate: JSON.stringify(messages).length / 4 // Rough estimate
    });

    const config: any = {
      temperature: temperature ?? 0.4,
      maxOutputTokens: effectiveMaxTokens,
    };

    // Enable thinking for models that support it
    if (thinkingLevel) {
      if (isGemini3) {
        // Gemini 3 uses thinkingLevel enum (minimal/low/medium/high).
        // Pass the level directly — no token budget parameter available.
        config.thinkingConfig = { includeThoughts: true, thinkingLevel };
      } else {
        // Gemini 2.5 uses thinkingBudget (token count).
        // Cap budget to prevent runaway token consumption.
        const thinkingBudgetByLevel: Record<string, number> = {
          'minimal': 1024,
          'low': 4096,
          'high': 16384,
        };
        const budgetTokens = thinkingBudgetByLevel[thinkingLevel] ?? 4096;
        config.thinkingConfig = { includeThoughts: true, thinkingBudget: budgetTokens };
      }
    }

    if (responseSchema && !tools) {
      config.responseMimeType = 'application/json';
      config.responseSchema = responseSchema;
    }

    if (systemMessage) {
      config.systemInstruction = typeof systemMessage.content === 'string'
        ? systemMessage.content
        : (systemMessage.content as any[]).map(p => p.text).join('\n');
    }

    if (tools && tools.length > 0) {
      config.tools = [
        {
          functionDeclarations: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        }
      ];
      // Tool calling mode: 'AUTO' lets model decide, 'ANY' forces at least one tool call
      // Default to 'AUTO' to allow flexible responses
      const mode = toolConfig?.mode || 'AUTO';
      config.toolConfig = {
        functionCallingConfig: {
          mode: mode,
          allowedFunctionNames: toolConfig?.allowedTools
        }
      };
    }

    // Process history and contents
    const contents = chatMessages.map(m => this.mapToGenAIContent(m));

    if (onProgress || onThinking) {
      let result;
      const streamStartTime = Date.now();
      const effectiveTimeout = streamTimeoutMs || GeminiProvider.DEFAULT_STREAM_TIMEOUT_MS;

      try {
        result = await this.client.models.generateContentStream({
          model: this.modelName,
          contents,
          config
        });
      } catch (error: any) {
        GeminiErrorHandler.handleSdkError(error);
      }

      const accumulator = new GeminiResponseAccumulator();
      let timedOut = false;
      let aborted = false;

      for await (const response of result) {
        // Check for abort signal
        if (abortSignal?.aborted) {
          console.warn('[GeminiProvider] Stream aborted by signal');
          aborted = true;
          break;
        }

        // Check for stream timeout
        const elapsed = Date.now() - streamStartTime;
        if (elapsed > effectiveTimeout) {
          console.warn(`[GeminiProvider] Stream timeout after ${elapsed}ms (limit: ${effectiveTimeout}ms). Breaking stream loop.`);
          timedOut = true;
          break;
        }

        const mapped = this.mapToLLMResponse(response);

        if (mapped.text) onProgress?.(mapped.text);
        if (mapped.thoughts) onThinking?.(mapped.thoughts);

        accumulator.append(mapped);
      }

      // Only validate if we completed normally (not timed out or aborted)
      if (!timedOut && !aborted) {
        GeminiErrorHandler.validateResponseContent(
          accumulator.getText(),
          accumulator.getToolCalls(),
          accumulator.getThoughts()
        );
      } else {
        // Log what we accumulated before timeout/abort for debugging
        console.log(`[GeminiProvider] Stream ${timedOut ? 'timed out' : 'aborted'}. Accumulated: ${accumulator.getText().length} chars text, ${accumulator.getToolCalls().length} tool calls`);
      }

      return accumulator.finalize();
    }

    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.modelName,
        contents,
        config
      });
    } catch (error: any) {
      GeminiErrorHandler.handleSdkError(error);
    }

    return this.mapToLLMResponse(response);
  }

  getToolSystemInstruction(tools: ToolDefinition[]): string {
    if (!tools || tools.length === 0) return '';

    return `
## TOOL CALLING PROTOCOL
You are equipped with professional design tools. Follow these rules:
1. Use native function calling for all tool interactions.
2. DO NOT wrap tool calls in XML tags like <tool_call>.
3. You can call multiple tools in a single turn if they are independent (e.g., multiple searches).
4. For sequential operations (like creating a node then styling it), ensure you use the result of the previous call.
`;
  }

  async *generateStream(options: LLMGenerateOptions): AsyncIterable<LLMResponse> {
    const res = await this.generate(options);
    yield res;
  }

  formatResponse(response: LLMResponse): LLMMessage {
    // If there are no tool calls, it's a simple text response
    if (!response.toolCalls || response.toolCalls.length === 0) {
      console.log(`[GeminiProvider.formatResponse] No tool calls, returning text response (${(response.text || '').length} chars)`);
      return {
        id: 'mdl_' + Math.random().toString(36).substring(7),
        role: 'model',
        content: response.text || ''
      };
    }

    // CRITICAL FOR GEMINI API: When tool calls exist, we must NOT include text content
    // in the same message if it follows a user turn. Function calls must come in a clean turn.
    //
    // [FIX] ALWAYS strip text parts when tool calls exist. Gemini produces 2000-8000 chars
    // of repetitive narration ("I'm now focused on...") BEFORE tool calls in streaming.
    // This text pollutes context (50K-200K tokens over 40 iterations) and reinforces the narration pattern.
    // We only keep functionCall and thought parts - text is discarded.
    let content: Part[];

    // [DEBUG] Log what we're working with
    const originalTextLength = (response.text || '').length;
    const fullPartsCount = response.fullParts?.length || 0;

    // Debug: categorize all parts
    const partCategories = response.fullParts?.map((p: any) => {
      if (p.functionCall) return 'functionCall';
      if (p.thought && typeof p.thought === 'string') return 'thought-string';
      if (p.thought === true && p.text) return 'thought-text'; // Gemini 3 style: { text: "...", thought: true }
      if (p.text) return 'text';
      return 'unknown';
    }) || [];
    console.log(`[GeminiProvider.formatResponse] Tool calls exist (${response.toolCalls.length}). Text: ${originalTextLength} chars, fullParts: ${fullPartsCount}, categories: [${partCategories.join(', ')}]`);

    // [FIX] Always build content from toolCalls directly.
    // Gemini streaming fullParts can include large thought-text blobs that bloat context.
    // toolCalls are already parsed and minimal, so use them exclusively.
    console.log(`[GeminiProvider.formatResponse] Building content from toolCalls (ignoring fullParts/text)`);
    content = response.toolCalls.map(tc => ({
      functionCall: { name: tc.name, args: tc.args },
      thought_signature: tc.thought_signature
    }));

    // [DEBUG] Final content size
    const contentJson = JSON.stringify(content);
    console.log(`[GeminiProvider.formatResponse] ✅ Final content: ${content.length} parts, ~${contentJson.length} chars JSON`);

    return {
      id: 'mdl_' + Math.random().toString(36).substring(7),
      role: 'model',
      content
    };
  }

  formatToolResults(results: LLMToolResult[]): LLMMessage {
    const content = results.map(tr => ({
      functionResponse: {
        name: tr.name,
        response: tr.response
      },
      // CRITICAL: Echo back thought_signature in the function response turns
      ...(tr.thought_signature && { thought_signature: tr.thought_signature })
    }));

    return { 
      id: 'tol_' + Math.random().toString(36).substring(7),
      role: 'tool', 
      content 
    };
  }

  private mapToLLMResponse(response: any): LLMResponse {
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;

    // [DEBUG] Log the raw response structure to diagnose issues
    // console.log('[GeminiProvider] Raw response:', JSON.stringify({
    //   ...
    // }, null, 2));

    GeminiErrorHandler.handleResponseError(response);

    const content = candidate?.content;
    const parts = content?.parts || [];

    let text = '';
    let thoughts = '';
    const toolCalls: LLMToolCall[] = [];
    const fullParts: Part[] = [];

    for (const part of parts) {
      if ('text' in part && part.text) {
        text += part.text;
        fullParts.push(part); // Preserve the original part object
      } else if ('thought' in part && part.thought) {
        thoughts += part.thought;
        fullParts.push(part); // Preserve the original part object
      } else if ('functionCall' in part && part.functionCall) {
        // FIX: Use 'functionCall' instead of 'call' to match actual Gemini API response format
        // Extract thoughtSignature (camelCase from API) and convert to internal snake_case
        const thoughtSignature = (part as any).thoughtSignature || (part as any).thought_signature;
        const toolCall: LLMToolCall = {
          id: (part.functionCall as any).id || 'call_' + Math.random().toString(36).substring(7),
          name: part.functionCall.name,
          args: part.functionCall.args,
          metadata: thoughtSignature ? { thought_signature: thoughtSignature } : undefined,
          thought_signature: thoughtSignature
        };
        toolCalls.push(toolCall);
        
        // Ensure we have a version with snake_case for internal logic, 
        // but keep the original object as much as possible in fullParts
        fullParts.push({
          ...part,
          thought_signature: thoughtSignature
        });
      }
    }

    return {
      text,
      thoughts: thoughts || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      fullParts: fullParts.length > 0 ? fullParts : undefined,
      usage: response.usageMetadata ? {
        promptTokens: response.usageMetadata.promptTokenCount || 0,
        completionTokens: response.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata.totalTokenCount || 0
      } : undefined
    };
  }

  private mapToGenAIContent(msg: LLMMessage): any {
    let role: string;
    if (msg.role === 'model') {
      role = 'model';
    } else if (msg.role === 'tool') {
      // In Gemini SDK, function results are technically under the 'user' role 
      // but are part of a specific Content structure.
      role = 'user'; 
    } else {
      role = 'user';
    }

    return {
      role,
      parts: typeof msg.content === 'string'
        ? [{ text: msg.content }]
        : (msg.content as any[]).map(p => {
          if (p.text) return { text: p.text };
          if (p.thought) return { thought: p.thought };
          if (p.functionCall) {
            return {
              functionCall: {
                name: p.functionCall.name,
                args: p.functionCall.args
              },
              thoughtSignature: p.thought_signature || p.thoughtSignature
            };
          }
          if (p.functionResponse) {
            return {
              functionResponse: {
                name: p.functionResponse.name,
                response: p.functionResponse.response
              },
              thoughtSignature: p.thought_signature || p.thoughtSignature
            };
          }
          return { text: '' };
        })
    };
  }
}
