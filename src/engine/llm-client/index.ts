/**
 * @file index.ts
 * @description Gemini service module exports
 * 
 * Re-exports all Gemini service functionality for clean imports:
 * import { generateLayout, fetchGeminiModels } from './gemini';
 */

// Configuration
export { GEMINI_CONFIG, MODEL_PATTERNS, DEFAULT_THINKING_LEVEL } from './config';
export type { ThinkingLevel } from './config';

// Types
export type {
  GenerateLayoutOptions,
} from './types';

// Model utilities
export {
  fetchGeminiModels,
  fetchOpenRouterModels,
  fetchModels,
  isAllowedModel,
  isGemini3Model
} from './modelFilter';
export type { LLMModel, RawGeminiModel } from './modelFilter';

// Core generation — protocol-based providers (Phase 9 replaces per-vendor classes)
export { OpenAIProtocolProvider } from './providers/openai-protocol';
export { AnthropicProtocolProvider } from './providers/anthropic-protocol';
export { GeminiProtocolProvider } from './providers/gemini-protocol';
export { ProxyProvider } from './providers/proxy';

// Gemini format utilities (shared by GeminiProtocolProvider + ProxyProvider)
export { mapGeminiPartsToLLMResponse, mapLLMMessageToGeminiContent, buildGeminiGenerationConfig, buildGeminiToolsPayload, ensureBase64 } from './providers/gemini/geminiFormat';





