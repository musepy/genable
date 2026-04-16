/**
 * @file geminiFormat.ts
 * @description Pure functions for Gemini API format conversion.
 * Shared by GeminiProvider (SDK) and ProxyProvider (raw HTTP).
 */

import { LLMResponse, ToolCallBlock, LLMToolResult, ContentBlock, LLMMessage } from '../types';
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
  const toolCalls: ToolCallBlock[] = [];
  const fullBlocks: ContentBlock[] = [];

  const sigPart = parts.find((p: any) => p.thoughtSignature || p.thought_signature);
  const sharedSignature = sigPart?.thoughtSignature || sigPart?.thought_signature;

  for (const part of parts) {
    const sig = part.thoughtSignature || part.thought_signature || sharedSignature;

    if (part.functionCall) {
      const tc: ToolCallBlock = {
        type: 'tool_call' as const,
        id: part.functionCall.id || randomId('call_'),
        name: part.functionCall.name,
        input: part.functionCall.args,
        thoughtSignature: sig,
      };
      toolCalls.push(tc);
      fullBlocks.push({ type: 'tool_call', id: tc.id, name: part.functionCall.name, input: part.functionCall.args, thoughtSignature: sig });
    } else if (part.thought) {
      const thoughtText = typeof part.thought === 'string' ? part.thought : (part.text || '');
      if (thoughtText) thoughts += thoughtText;
      fullBlocks.push({ type: 'thinking', text: thoughtText, signature: sig });
    } else if (part.text) {
      text += part.text;
      fullBlocks.push({ type: 'text', text: part.text });
    }
  }

  return {
    text,
    thoughts: thoughts || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    fullBlocks: fullBlocks.length > 0 ? fullBlocks : undefined,
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
    : (msg.content as ContentBlock[]).map((block) => {
      if (block.type === 'thinking') {
        const sig = block.signature ? ensureBase64(block.signature) : undefined;
        return { text: block.text, thought: true, ...(sig && { thoughtSignature: sig }) };
      }
      if (block.type === 'tool_call') {
        const sig = block.thoughtSignature ? ensureBase64(block.thoughtSignature) : undefined;
        return { functionCall: { name: block.name, args: block.input }, ...(sig && { thoughtSignature: sig }) };
      }
      if (block.type === 'tool_result') {
        const sig = block.thoughtSignature ? ensureBase64(block.thoughtSignature) : undefined;
        return { functionResponse: { name: block.name, response: block.data }, ...(sig && { thoughtSignature: sig }) };
      }
      if (block.type === 'image') return { inlineData: { mimeType: block.mimeType, data: block.data } };
      if (block.type === 'text') return { text: block.text };
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

/** Format a Gemini LLM response into a history message, preserving fullBlocks with thought metadata. */
export function formatResponseGemini(response: LLMResponse): LLMMessage {
  if (!response.toolCalls || response.toolCalls.length === 0) {
    return { id: randomId('mdl_'), role: 'model', content: response.text || '' };
  }
  const content = (response.fullBlocks || []).filter((b) => {
    return b.type === 'tool_call' || b.type === 'thinking' || (b.type === 'text' && b.text.trim() !== '');
  });
  return { id: randomId('mdl_'), role: 'model', content };
}

/** Format tool results into a Gemini history message, preserving thoughtSignature and image attachments. */
export function formatToolResultsGemini(results: LLMToolResult[]): LLMMessage {
  const content: ContentBlock[] = [];
  for (const tr of results) {
    content.push({
      type: 'tool_result',
      id: tr.id || '',
      name: tr.name,
      data: tr.response,
      isError: tr.isError,
      thoughtSignature: tr.thought_signature,
    });
    if (tr.imageAttachment) {
      content.push({ type: 'image', mimeType: tr.imageAttachment.mimeType, data: tr.imageAttachment.data });
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
