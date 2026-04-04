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

// Core generation
export { GeminiProvider } from './providers/gemini';
export { OpenRouterProvider } from './providers/openrouter';
export { DashScopeProvider } from './providers/dashscope';
export { AnthropicProvider } from './providers/anthropic';
export { ProxyProvider } from './providers/proxy';
export { OPENROUTER_CONFIG, DASHSCOPE_CONFIG, ANTHROPIC_CONFIG } from './config';

// Gemini format utilities (shared by GeminiProvider + ProxyProvider)
export { mapGeminiPartsToLLMResponse, mapLLMMessageToGeminiContent, buildGeminiGenerationConfig, buildGeminiToolsPayload, ensureBase64 } from './providers/gemini/geminiFormat';





