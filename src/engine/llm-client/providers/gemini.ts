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

  constructor(private apiKey: string, private modelName: string, options?: { accessToken?: string; vertexProject?: string; vertexLocation?: string }) {
    if (options?.accessToken && options?.vertexProject) {
      // Vertex AI OAuth mode: use GCP project + access token
      this.client = new GoogleGenAI({
        vertexai: true,
        project: options.vertexProject,
        location: options.vertexLocation || 'us-central1',
        httpOptions: {
          headers: { 'Authorization': `Bearer ${options.accessToken}` },
        },
      });
    } else {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  /** Default stream timeout: 30 seconds */
  private static readonly DEFAULT_STREAM_TIMEOUT_MS = 30000;

  private static readonly PROVIDER_VERSION = 'v2026-02-13-fix2';

  getCapabilities() {
    return {
      supportsTextStreaming: true,
      supportsReasoningStreaming: true,
    };
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature, maxTokens, thinkingLevel, responseSchema, toolConfig, onProgress, onThinking, abortSignal, streamTimeoutMs } = options;

    GeminiLogger.info(`generate() called, tools=${tools?.length || 0}, toolConfig=${JSON.stringify(toolConfig)}`);

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
        // [FIX] Gemini 3 'thinkingLevel' expects 'LOW', 'MEDIUM', 'HIGH'.
        // Map our internal 'minimal' to 'LOW'.
        let apiLevel = thinkingLevel.toUpperCase();
        if (apiLevel === 'MINIMAL') apiLevel = 'LOW';
        
        config.thinkingConfig = { 
          thinkingLevel: apiLevel
        };
      } else {
        // Gemini 2.5 uses thinkingBudget (token count).
        // Cap budget to prevent runaway token consumption.
        const thinkingBudgetByLevel: Record<string, number> = {
          'minimal': 1024,
          'low': 4096,
          'medium': 10240,
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
      let mode = toolConfig?.mode || 'AUTO';

      // [FIX] Gemini API returns 400 INVALID_ARGUMENT when using 'ANY' mode with many
      // function declarations. Gemini 3: limit ~15 tools. Gemini 2.5: "too many states" error.
      // Downgrade to 'AUTO' when tool count exceeds the safe threshold.
      const ANY_MODE_TOOL_LIMIT = 12;
      if (mode === 'ANY' && tools.length > ANY_MODE_TOOL_LIMIT) {
        console.warn(
          `[GeminiProvider] ⚠️ Downgrading toolConfig mode from ANY to AUTO: ${tools.length} tools exceeds limit ~${ANY_MODE_TOOL_LIMIT}`
        );
        mode = 'AUTO';
      }

      // [FIX] Defensively filter allowedTools to ensure they are a subset of provided tools.
      // If we specify a tool in allowedFunctionNames that isn't in functionDeclarations, Gemini returns a 400.
      const allowed = toolConfig?.allowedTools;
      const declarationNames = tools.map(t => t.name);
      const safeAllowed = allowed?.filter(name => declarationNames.includes(name));

      config.toolConfig = {
        functionCallingConfig: {
          mode: mode,
          allowedFunctionNames: (safeAllowed && safeAllowed.length > 0) ? safeAllowed : undefined
        }
      };
    }

    // Process history and contents
    const contents = chatMessages.map((m) => this.mapToGenAIContent(m));

    if (onProgress || onThinking) {
      let result;
      const streamStartTime = Date.now();
      const effectiveTimeout = streamTimeoutMs || GeminiProvider.DEFAULT_STREAM_TIMEOUT_MS;

      try {
        result = await (this.client as any).models.generateContentStream({
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
        GeminiLogger.warn(`Stream ${timedOut ? 'timed out' : 'aborted'}. Accumulated: ${accumulator.getText().length} chars text, ${accumulator.getToolCalls().length} tool calls`);
      }

      return accumulator.finalize();
    }

    let response;
    try {
      response = await (this.client as any).models.generateContent({
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

    // Centralized in promptRegistry — single source of truth
    const { TOOL_CALLING_PROTOCOL } = require('../../prompt/promptRegistry');
    return TOOL_CALLING_PROTOCOL;
  }

  async *generateStream(options: LLMGenerateOptions): AsyncIterable<LLMResponse> {
    const res = await this.generate(options);
    yield res;
  }

  formatResponse(response: LLMResponse): LLMMessage {
    if (!response.toolCalls || response.toolCalls.length === 0) {
      GeminiLogger.debug(`formatResponse: No tool calls, returning text response (${(response.text || '').length} chars)`);
      return {
        id: 'mdl_' + Math.random().toString(36).substring(7),
        role: 'model',
        content: response.text || ''
      };
    }

    // [FIX] Protocol Transparency: Always include all original content parts.
    // This ensures Thinking models have the full context needed for signature validation.
    const fullPartsCount = response.fullParts?.length || 0;
    GeminiLogger.debug(`formatResponse: Tool calls exist (${response.toolCalls.length}). Preserving all ${fullPartsCount} parts.`);
    let content: Part[];

    // [DEBUG] Log what we're working with
    const originalTextLength = (response.text || '').length;

    // Debug: categorize all parts
    const partCategories = response.fullParts?.map((p: any) => {
      if (p.functionCall) return 'functionCall';
      if (p.thought && typeof p.thought === 'string') return 'thought-string';
      if (p.thought === true && p.text) return 'thought-text'; // Gemini 3 style: { text: "...", thought: true }
      if (p.text) return 'text';
      return 'unknown';
    }) || [];
    GeminiLogger.debug(`formatResponse: Tool calls exist (${response.toolCalls.length}). Text: ${originalTextLength} chars, fullParts: ${fullPartsCount}, categories: [${partCategories.join(', ')}]`);

    // [FIX] Protocol Transparency: Preserve all parts (thoughts, text, tool calls)
    // filtering out only empty or invalid items.
    content = (response.fullParts || []).filter((p: any) => {
      // Keep everything that is not effectively empty
      return p.functionCall || p.thought || (p.text && p.text.trim() !== '');
    });

    // [DEBUG] Final content size
    const contentJson = JSON.stringify(content);
    GeminiLogger.debug(`formatResponse: ✅ Final content: ${content.length} parts, ~${contentJson.length} chars JSON`);

    return {
      id: 'mdl_' + Math.random().toString(36).substring(7),
      role: 'model',
      content
    };
  }

  formatToolResults(results: LLMToolResult[]): LLMMessage {
    const content: Part[] = [];

    for (const tr of results) {
      content.push({
        functionResponse: {
          name: tr.name,
          response: tr.response
        },
        // [FIX] Restore thought_signature propagation. Gemini 3 requires this
        // in tool responses to maintain reasoning state.
        thought_signature: tr.thought_signature
      } as any);

      // Append inlineData part after the functionResponse so the LLM can "see" images
      if (tr.imageAttachment) {
        content.push({
          inlineData: {
            mimeType: tr.imageAttachment.mimeType,
            data: tr.imageAttachment.data
          }
        });
      }
    }

    return {
      id: 'tol_' + Math.random().toString(36).substring(7),
      role: 'tool',
      content
    };
  }

  private mapToLLMResponse(response: any): LLMResponse {
    GeminiErrorHandler.handleResponseError(response);

    const candidate = response.candidates?.[0];
    const content = candidate?.content;
    const parts = content?.parts || [];

    let text = '';
    let thoughts = '';
    const toolCalls: LLMToolCall[] = [];
    const fullParts: Part[] = [];

    // 1. Identify shared signature in this turn
    const sharedSignature = parts.find((p: any) => p.thoughtSignature || p.thought_signature)
      ? ((parts.find((p: any) => p.thoughtSignature || p.thought_signature) as any).thoughtSignature || 
         (parts.find((p: any) => p.thoughtSignature || p.thought_signature) as any).thought_signature)
      : undefined;

    if (sharedSignature) {
      GeminiLogger.debug(`mapToLLMResponse: Turn-level signature detected: "${sharedSignature.slice(0, 10)}..."`);
    }

    // 2. Process parts - but DO NOT collect standalone signature parts into fullParts
    for (const part of parts) {
      if ('functionCall' in part && part.functionCall) {
        GeminiLogger.debug(`mapToLLMResponse: functionCall: ${part.functionCall.name}`);
        const partSig = (part as any).thoughtSignature || (part as any).thought_signature;
        const sig = partSig || sharedSignature;
        
        const toolCall: LLMToolCall = {
          id: (part.functionCall as any).id || 'call_' + Math.random().toString(36).substring(7),
          name: part.functionCall.name,
          args: part.functionCall.args,
          metadata: sig ? { thought_signature: sig } : undefined,
          thought_signature: sig
        };
        toolCalls.push(toolCall);

        fullParts.push({
          ...part,
          functionCall: {
            ...part.functionCall,
            id: toolCall.id
          },
          thought_signature: sig
        });
      } else if ('thought' in part && part.thought) {
        const thoughtText = typeof part.thought === 'string' ? part.thought : (part as any).text || '';
        if (thoughtText) thoughts += thoughtText;
        
        const partSig = (part as any).thoughtSignature || (part as any).thought_signature;
        const sig = partSig || sharedSignature;
        fullParts.push({
          ...part,
          thought_signature: sig
        } as any);
      } else if ('text' in part && part.text) {
        text += part.text;
        
        // Protocol Transparency: Preserve original text part with its original signature (if any)
        const partSig = (part as any).thoughtSignature || (part as any).thought_signature;
        const sig = partSig || sharedSignature;
        fullParts.push({
          ...part,
          thought_signature: sig
        } as any);
      }
      // CRITICAL: Standalone signature parts are NOT pushed to fullParts anymore.
      // They are used only for extracting sharedSignature (handled above).
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

  /**
   * [FIX] Ensures the signature is valid base64. 
   * Skips re-encoding if the string already looks like valid base64 
   * to avoid corrupting Gemini signatures (which often contain URL-safe chars).
   */
  private ensureBase64(str: string): string {
    if (!str) return '';
    
    // If it's already a clean base64 string, return it as is.
    // Standard base64 and URL-safe base64 both allowed.
    const base64Regex = /^[A-Za-z0-9+/_-]+=*$/;
    if (base64Regex.test(str)) {
      return str;
    }

    try {
      return Buffer.from(str).toString('base64');
    } catch (e) {
      return str;
    }
  }

  private mapToGenAIContent(msg: LLMMessage): any {
    let role: string;
    if (msg.role === 'model') {
      role = 'model';
    } else if (msg.role === 'tool') {
      role = 'user'; 
    } else {
      role = 'user';
    }

    return {
      role,
      parts: typeof msg.content === 'string'
        ? [{ text: msg.content }]
        : (msg.content as any[]).map((p, idx) => {
          const rawSig = p.thought_signature || p.thoughtSignature;
          const sig = rawSig ? this.ensureBase64(rawSig) : undefined;
          
          // CRITICAL: Order matters! Check functional parts (thought, functionCall, functionResponse) 
          // before generic text, because a thought part may also contain text.
          if (p.thought) {
             // Gemini 3 style: { thought: true, text: "..." }
             if (p.thought === true && p.text) {
               return { text: p.text, thought: true, ...(sig && { thoughtSignature: sig }) };
             }
             // Gemini 2.5 style: { thought: "..." }
             return { thought: p.thought, ...(sig && { thoughtSignature: sig }) };
          }
          if (p.functionCall) {
            return {
              functionCall: {
                name: p.functionCall.name,
                args: p.functionCall.args
              },
              ...(sig && { thoughtSignature: sig })
            };
          }
          if (p.functionResponse) {
            return {
              functionResponse: {
                name: p.functionResponse.name,
                response: p.functionResponse.response
              },
              // [FIX] Propagate thought_signature (mapped to camelCase thoughtSignature)
              // Gemini 3 Flash/Pro requires this on functionResponse parts to maintain session state.
              ...(sig && { thoughtSignature: sig })
            };
          }
          if (p.inlineData) {
            return {
              inlineData: {
                mimeType: p.inlineData.mimeType,
                data: p.inlineData.data
              }
            };
          }
          if (p.text) {
            return {
              text: p.text
            };
          }

          return { text: '' };
        }).filter((p: any) => {
           // Filter out "empty" parts
           if (p.text === '' && Object.keys(p).length === 1) return false;
           return (p.text !== undefined || p.thought !== undefined || p.functionCall !== undefined || p.functionResponse !== undefined || p.inlineData !== undefined);
        })
    };
  }
}
