/**
 * @file types.ts
 * @description Common interfaces for LLM Providers — tagged-union content blocks,
 * provider-neutral message format, and shared adapters.
 *
 * Design principles (aligned with pimono/Claude Code):
 * - ContentBlock: tagged union with `type` discriminator
 * - ToolCallBlock: single type for both dispatch and message history
 * - System prompt: separated from message array via LLMGenerateOptions.system
 * - Message metadata: only `summaryOf` (context compression bookkeeping)
 */

import { ToolDefinition, ToolResponse } from '../../agent/tools/types';

// ═══════════════════════════════════════════════════════════════
// Content blocks (tagged union)
// ═══════════════════════════════════════════════════════════════

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolCallBlock {
  type: 'tool_call';
  id: string;
  name: string;
  input: Record<string, any>;
  thoughtSignature?: string;
}

export interface ToolResultBlock {
  type: 'tool_result';
  id: string;
  name: string;
  data: any;
  isError?: boolean;
  thoughtSignature?: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  text: string;
  signature?: string;
}

export interface ImageBlock {
  type: 'image';
  mimeType: string;
  data: string;
}

export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock | ThinkingBlock | ImageBlock;

// ═══════════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════════

export type MessageRole = 'system' | 'user' | 'model' | 'tool';

export interface LLMMessage {
  id: string;
  role: MessageRole;
  content: string | ContentBlock[];
  summaryOf?: string[];
}

// ═══════════════════════════════════════════════════════════════
// Tool result (intermediate type for raw tool output before formatting)
// ═══════════════════════════════════════════════════════════════

export interface LLMToolResult {
  name: string;
  response: any;
  id?: string;
  isError?: boolean;
  thought_signature?: string;
  imageAttachment?: {
    mimeType: string;
    data: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// LLM Response
// ═══════════════════════════════════════════════════════════════

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

export function normalizeFinishReason(raw: string | null | undefined): FinishReason | undefined {
  if (!raw) return undefined;
  switch (raw) {
    case 'stop':
    case 'end_turn':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'tool_calls':
    case 'tool_use':
    case 'function_call':
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    default:
      return undefined;
  }
}

export interface LLMResponse {
  text: string;
  toolCalls?: ToolCallBlock[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  };
  thoughts?: string;
  fullBlocks?: ContentBlock[];
  finishReason?: FinishReason;
}

export interface LLMGenerateOptions {
  system?: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  models?: string[];
  streaming?: boolean;
  onProgress?: (chunk: string) => void;
  onThinking?: (thought: string) => void;
  responseSchema?: Record<string, any>;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  toolConfig?: LLMToolConfig;
  abortSignal?: AbortSignal;
}

export interface LLMToolConfig {
  mode?: 'AUTO' | 'ANY' | 'NONE';
  allowedTools?: string[];
}

export interface LLMProviderCapabilities {
  supportsTextStreaming: boolean;
  supportsReasoningStreaming: boolean;
  supportsVision: boolean;
  contextWindow: number;
}

export const DEFAULT_PROVIDER_CAPABILITIES: LLMProviderCapabilities = {
  supportsTextStreaming: false,
  supportsReasoningStreaming: false,
  supportsVision: false,
  contextWindow: 1_000_000,
};

export interface LLMProvider {
  name: string;
  generate(options: LLMGenerateOptions): Promise<LLMResponse>;
  generateStream?(options: LLMGenerateOptions): AsyncIterable<LLMResponse>;
  getCapabilities?(): LLMProviderCapabilities;
  formatResponse(response: LLMResponse): LLMMessage;
  formatToolResults(results: LLMToolResult[]): LLMMessage;
  getToolSystemInstruction(tools: ToolDefinition[]): string;
}

// ═══════════════════════════════════════════════════════════════
// Default formatters
// ═══════════════════════════════════════════════════════════════

function randomId(prefix: string): string {
  return prefix + '_' + Math.random().toString(36).substring(7);
}

export function formatResponseDefault(response: LLMResponse): LLMMessage {
  if (response.toolCalls && response.toolCalls.length > 0) {
    const content: ContentBlock[] = [];
    if (response.text) content.push({ type: 'text', text: response.text });
    content.push(...response.toolCalls);
    return { id: randomId('gen'), role: 'model', content };
  }
  return { id: randomId('gen'), role: 'model', content: response.text || '' };
}

export function formatToolResultsDefault(results: LLMToolResult[]): LLMMessage {
  const content: ContentBlock[] = [];
  for (const tr of results) {
    content.push({
      type: 'tool_result' as const,
      id: tr.id || '',
      name: tr.name,
      data: tr.response,
      isError: tr.isError,
    });
    if (tr.imageAttachment) {
      content.push({ type: 'image', mimeType: tr.imageAttachment.mimeType, data: tr.imageAttachment.data });
    }
  }
  return { id: randomId('gen'), role: 'tool', content };
}

export function getToolSystemInstructionDefault(_tools: ToolDefinition[]): string {
  return '';
}

// ═══════════════════════════════════════════════════════════════
// Type guards
// ═══════════════════════════════════════════════════════════════

export function isTextBlock(b: ContentBlock): b is TextBlock { return b.type === 'text'; }
export function isToolCallBlock(b: ContentBlock): b is ToolCallBlock { return b.type === 'tool_call'; }
export function isToolResultBlock(b: ContentBlock): b is ToolResultBlock { return b.type === 'tool_result'; }
export function isThinkingBlock(b: ContentBlock): b is ThinkingBlock { return b.type === 'thinking'; }
export function isImageBlock(b: ContentBlock): b is ImageBlock { return b.type === 'image'; }
