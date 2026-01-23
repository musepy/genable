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
  GenerateLayoutWithRetryOptions,
  GenerateLayoutWithRetryResult,
} from './types';

// Model utilities
export {
  fetchGeminiModels,
  isAllowedModel,
  isGemini3Model
} from './modelFilter';
export type { GeminiModel, RawGeminiModel } from './modelFilter';

// Core generation
export { generateLayout, generateLayoutWithValidation } from './generator';
export { generateLayoutWithRetry } from './retryLoop';

// Distributed Generation (5-Phase Thinking)
export { DistributedGenerator } from './distributed/distributedGenerator';
export { ThinkingPhase } from './distributed/types';
export type { PhaseOutput, GenerationContext } from './distributed/types';
