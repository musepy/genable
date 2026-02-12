/**
 * @file types.ts
 * @description Common interfaces for LLM Providers to support tool-use and model abstraction.
 */

import { ToolDefinition, ToolResponse } from '../../agent/tools/types';

export type MessageRole = 'system' | 'user' | 'model' | 'tool';

/**
 * Common message format for all LLM providers.
 * Providers are responsible for mapping these roles to their specific API formats.
 * - 'system': System instructions
 * - 'user': Human input
 * - 'model': Assistant/AI response (may include function calls)
 * - 'tool': Response from a tool/function execution
 */
export interface LLMMessage {
  id: string; // Unique identifier for tracking and reversibility
  role: MessageRole;
  content: string | Part[];
  hidden?: boolean; // If true, this message is excluded from the current context sent to LLM
  summaryOf?: string[]; // IDs of original messages that this message summarizes
  pinned?: boolean; // If true, this message survives context compression (e.g., original user request)
}

export interface Part {
  text?: string;
  functionCall?: {
    name: string;
    args: any;
  };
  functionResponse?: {
    name: string;
    response: any;
  };
  /** Unique identifier for tool call, required for OpenAI-compatible APIs */
  tool_call_id?: string;
  /** Thought flag for Gemini 3 thinking process content */
  thought?: boolean;
  /** Thought signature for Gemini 3 function calling - must be returned in next turn */
  thought_signature?: string;
}

export interface LLMToolCall {
  id?: string;
  name: string;
  args: any;
  /** Internal metadata for specific providers (e.g. Gemini thought signatures) */
  metadata?: Record<string, any>;
  /** Official snake_case field for Gemini 3 function calling */
  /** Official snake_case field for Gemini 3 function calling */
  thought_signature?: string;
}

export interface LLMToolResult {
  name: string;
  response: any;
  id?: string; // Original tool call ID
  thought_signature?: string;
}

export interface LLMResponse {
  text: string;
  toolCalls?: LLMToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  thoughts?: string;
  /** Full original parts from the provider to ensure exact history reconstruction */
  fullParts?: Part[];
}

export interface LLMGenerateOptions {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  models?: string[]; // Multiple models for fallback/routing (e.g. OpenRouter)
  streaming?: boolean;
  onProgress?: (chunk: string) => void;
  onThinking?: (thought: string) => void;
  /** Constrained response schema (optional) */
  responseSchema?: Record<string, any>;
  /** Thinking level for models that support it */
  thinkingLevel?: 'minimal' | 'low' | 'high';
  /** Configuration for tool calling behavior (optional) */
  toolConfig?: LLMToolConfig;
  /** AbortSignal for cancelling streaming requests */
  abortSignal?: AbortSignal;
  /** Stream timeout in milliseconds (optional, provider-specific default if not set) */
  streamTimeoutMs?: number;
}

/**
 * Common tool configuration behavior
 */
export interface LLMToolConfig {
  /** 
   * 'AUTO': Model decides whether to call tools
   * 'ANY': Model MUST call at least one tool ( Gemini 'ANY', OpenAI 'required' )
   * 'NONE': Model must NOT call any tools
   */
  mode?: 'AUTO' | 'ANY' | 'NONE';
  /** Optional list of tool names that the model is allowed to call */
  allowedTools?: string[];
}

export interface LLMProvider {
  name: string;
  generate(options: LLMGenerateOptions): Promise<LLMResponse>;
  generateStream?(options: LLMGenerateOptions): AsyncIterable<LLMResponse>;
  
  /**
   * Format an LLM response into a message for history record.
   * This allows providers to handle model-specific constraints (e.g. Gemini's tool call turns).
   */
  formatResponse(response: LLMResponse): LLMMessage;

  /**
   * Format tool execution results into a message for history record.
   * This allows providers to echo back signatures or metadata required by the specific model.
   */
  formatToolResults(results: LLMToolResult[]): LLMMessage;

  /**
   * Get provider-specific system instructions for tool usage.
   * This allows decoupling the prompt format from the content composer.
   */
  getToolSystemInstruction(tools: ToolDefinition[]): string;
}

/**
 * Default implementation for formatResponse (standard model -> message mapping)
 */
export function formatResponseDefault(response: LLMResponse): LLMMessage {
  if (response.toolCalls && response.toolCalls.length > 0) {
    const content: Part[] = [];
    if (response.text) content.push({ text: response.text });
    
    content.push(...response.toolCalls.map(tc => ({
      functionCall: { name: tc.name, args: tc.args },
      tool_call_id: tc.id,
      thought_signature: tc.thought_signature
    })));

    return {
      id: 'gen_' + Math.random().toString(36).substring(7),
      role: 'model',
      content
    };
  }
  return { 
    id: 'gen_' + Math.random().toString(36).substring(7),
    role: 'model', 
    content: response.text || '' 
  };
}

/**
 * Default implementation for formatToolResults (standard tool results -> message mapping)
 */
export function formatToolResultsDefault(results: LLMToolResult[]): LLMMessage {
  return {
    id: 'gen_' + Math.random().toString(36).substring(7),
    role: 'tool',
    content: results.map(tr => ({
      functionResponse: { name: tr.name, response: tr.response },
      ...(tr.thought_signature && { thought_signature: tr.thought_signature })
    }))
  };
}
