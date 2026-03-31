/**
 * @file geminiFormat.ts
 * @description Pure functions for Gemini API format conversion.
 * Shared by GeminiProvider (SDK) and ProxyProvider (raw HTTP).
 */

import { LLMResponse, LLMToolCall, LLMToolResult, Part, LLMMessage } from '../types';
import { ToolDefinition } from '../../../agent/tools/types';
import { isGemini3Model } from '../../modelFilter';
import { GEMINI_CONFIG } from '../../config';

function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(7);
}

/** Ensures a string is valid base64, encoding it if necessary. */
export function ensureBase64(str: string): string {
  if (!str) return '';
  const base64Regex = /^[A-Za-z0-9+/_-]+=*$/;
  if (base64Regex.test(str)) return str;
  try {
    return Buffer.from(str).toString('base64');
  } catch {
    return str;
  }
}

/**
 * Maps Gemini response parts to LLMResponse.
 * Caller must handle error checking before calling this function.
 */
export function mapGeminiPartsToLLMResponse(
  parts: any[],
  usageMetadata?: any,
): LLMResponse {
  let text = '';
  let thoughts = '';
  const toolCalls: LLMToolCall[] = [];
  const fullParts: Part[] = [];

  const sigPart = parts.find((p: any) => p.thoughtSignature || p.thought_signature);
  const sharedSignature = sigPart?.thoughtSignature || sigPart?.thought_signature;

  for (const part of parts) {
    const sig = part.thoughtSignature || part.thought_signature || sharedSignature;

    if (part.functionCall) {
      const tc: LLMToolCall = {
        id: part.functionCall.id || randomId('call_'),
        name: part.functionCall.name,
        args: part.functionCall.args,
        metadata: sig ? { thought_signature: sig } : undefined,
        thought_signature: sig,
      };
      toolCalls.push(tc);
      fullParts.push({ ...part, functionCall: { ...part.functionCall, id: tc.id }, thought_signature: sig });
    } else if (part.thought) {
      const thoughtText = typeof part.thought === 'string' ? part.thought : (part.text || '');
      if (thoughtText) thoughts += thoughtText;
      fullParts.push({ ...part, thought_signature: sig } as any);
    } else if (part.text) {
      text += part.text;
      fullParts.push({ ...part, thought_signature: sig } as any);
    }
  }

  return {
    text,
    thoughts: thoughts || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    fullParts: fullParts.length > 0 ? fullParts : undefined,
    usage: usageMetadata ? {
      promptTokens: usageMetadata.promptTokenCount || 0,
      completionTokens: usageMetadata.candidatesTokenCount || 0,
      totalTokens: usageMetadata.totalTokenCount || 0,
      cachedTokens: usageMetadata.cachedContentTokenCount || undefined,
    } : undefined,
  };
}

/** Maps an LLMMessage to Gemini content format `{role, parts}`. */
export function mapLLMMessageToGeminiContent(msg: LLMMessage): any {
  const role = msg.role === 'model' ? 'model' : 'user';
  const parts = typeof msg.content === 'string'
    ? [{ text: msg.content }]
    : (msg.content as any[]).map((p: any) => {
      const rawSig = p.thought_signature || p.thoughtSignature;
      const sig = rawSig ? ensureBase64(rawSig) : undefined;

      if (p.thought) {
        if (p.thought === true && p.text) return { text: p.text, thought: true, ...(sig && { thoughtSignature: sig }) };
        return { thought: p.thought, ...(sig && { thoughtSignature: sig }) };
      }
      if (p.functionCall) return { functionCall: { name: p.functionCall.name, args: p.functionCall.args }, ...(sig && { thoughtSignature: sig }) };
      if (p.functionResponse) return { functionResponse: { name: p.functionResponse.name, response: p.functionResponse.response }, ...(sig && { thoughtSignature: sig }) };
      if (p.inlineData) return { inlineData: { mimeType: p.inlineData.mimeType, data: p.inlineData.data } };
      if (p.text) return { text: p.text };
      return { text: '' };
    }).filter((p: any) => {
      if (p.text === '' && Object.keys(p).length === 1) return false;
      return p.text !== undefined || p.thought !== undefined || p.functionCall !== undefined || p.functionResponse !== undefined || p.inlineData !== undefined;
    });

  return { role, parts };
}

// ═══════════════════════════════════════════════════════════════
// History formatting: LLMResponse/LLMToolResult → LLMMessage
// Shared by GeminiProvider and ProxyProvider.
// ═══════════════════════════════════════════════════════════════

/** Format a Gemini LLM response into a history message, preserving fullParts with thought metadata. */
export function formatResponseGemini(response: LLMResponse): LLMMessage {
  if (!response.toolCalls || response.toolCalls.length === 0) {
    return { id: randomId('mdl_'), role: 'model', content: response.text || '' };
  }
  const content = (response.fullParts || []).filter((p: any) => {
    return p.functionCall || p.thought || (p.text && p.text.trim() !== '');
  });
  return { id: randomId('mdl_'), role: 'model', content };
}

/** Format tool results into a Gemini history message, preserving thought_signature and image attachments. */
export function formatToolResultsGemini(results: LLMToolResult[]): LLMMessage {
  const content: Part[] = [];
  for (const tr of results) {
    content.push({
      functionResponse: { name: tr.name, response: tr.response },
      thought_signature: tr.thought_signature,
    } as any);
    if (tr.imageAttachment) {
      content.push({ inlineData: { mimeType: tr.imageAttachment.mimeType, data: tr.imageAttachment.data } });
    }
  }
  return { id: randomId('tol_'), role: 'tool', content };
}

/** Builds the Gemini generationConfig object (temperature, thinking, schema). */
export function buildGeminiGenerationConfig(opts: {
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: string;
  responseSchema?: Record<string, any>;
  hasTools?: boolean;
}): Record<string, any> {
  const { modelName, temperature, maxTokens, thinkingLevel, responseSchema, hasTools } = opts;
  const isGemini3 = isGemini3Model(modelName);

  const config: Record<string, any> = {
    temperature: temperature ?? 0.4,
    maxOutputTokens: maxTokens || GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
  };

  if (thinkingLevel) {
    if (isGemini3) {
      let apiLevel = thinkingLevel.toUpperCase();
      if (apiLevel === 'MINIMAL') apiLevel = 'LOW';
      config.thinkingConfig = { thinkingLevel: apiLevel };
    } else {
      const budgetMap: Record<string, number> = { minimal: 1024, low: 4096, medium: 10240, high: 16384 };
      config.thinkingConfig = { includeThoughts: true, thinkingBudget: budgetMap[thinkingLevel] ?? 4096 };
    }
  }

  if (responseSchema && !hasTools) {
    config.responseMimeType = 'application/json';
    config.responseSchema = responseSchema;
  }

  return config;
}

/** Builds the Gemini tools and toolConfig payloads. Returns undefined if no tools. */
export function buildGeminiToolsPayload(
  tools: ToolDefinition[] | undefined,
  toolConfig?: { mode?: string; allowedTools?: string[] },
): { tools: any[]; toolConfig: any } | undefined {
  if (!tools || tools.length === 0) return undefined;

  const toolsPayload = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];

  let mode = toolConfig?.mode || 'AUTO';
  const ANY_MODE_TOOL_LIMIT = 12;
  if (mode === 'ANY' && tools.length > ANY_MODE_TOOL_LIMIT) {
    console.warn(`[GeminiFormat] Downgrading toolConfig mode from ANY to AUTO: ${tools.length} tools exceeds limit ~${ANY_MODE_TOOL_LIMIT}`);
    mode = 'AUTO';
  }

  const allowed = toolConfig?.allowedTools;
  const declarationNames = tools.map(t => t.name);
  const safeAllowed = allowed?.filter(name => declarationNames.includes(name));

  const toolConfigPayload = {
    functionCallingConfig: {
      mode,
      allowedFunctionNames: (safeAllowed && safeAllowed.length > 0) ? safeAllowed : undefined,
    },
  };

  return { tools: toolsPayload, toolConfig: toolConfigPayload };
}
