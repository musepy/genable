/**
 * Recommended models configuration and sorting utilities
 * 
 * Architecture: "Static Manifest + Client Cache + SWR Refresh"
 * - SUPPORTED_MODELS: Bundled defaults (instant availability)
 * - Cache: Persisted in clientStorage (survive plugin restarts)
 * - SWR: Background refresh when cache > 24h stale
 */

import { sortModelsGeneric, SortableModel } from '../../engine/llm-client/modelEngine';
import { MODEL_DISPLAY_LABELS, MODEL_FAMILIES } from '../../constants';

// [SSOT] Stable default for UI and fresh installations
export const DEFAULT_MODEL = MODEL_FAMILIES.GEMINI_2_5_FLASH;

/** [SSOT] Hard fallback for emergency recovery in main thread storage */
export const FALLBACK_MODEL = MODEL_FAMILIES.GEMINI_2_5_FLASH;

/** Cache expiry duration (24 hours in milliseconds) */
export const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Model tier for categorization */
export type ModelTier = 'fast' | 'balanced' | 'preview';

/** Model configuration interface */
export interface ModelConfig {
  name: string;
  displayName: string;
  tier: ModelTier;
  isFree?: boolean;
}

/**
 * Static model manifest - bundled at build time
 * Provides instant availability without API call.
 * isFree: Gemini Flash/Lite = free tier, Pro = paid only.
 *         OpenRouter: based on `:free` suffix or known pricing.
 */
export const SUPPORTED_MODELS: Record<string, ModelConfig[]> = {
  gemini: [
    { name: MODEL_FAMILIES.GEMINI_3_FLASH_PREVIEW, displayName: 'Gemini 3 Flash', tier: 'fast', isFree: true },
    { name: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', tier: 'fast', isFree: true },
    { name: MODEL_FAMILIES.GEMINI_2_5_FLASH, displayName: 'Gemini 2.5 Flash', tier: 'fast', isFree: true },
    { name: MODEL_FAMILIES.GEMINI_2_5_PRO, displayName: 'Gemini 2.5 Pro', tier: 'balanced', isFree: false },
    { name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', tier: 'fast', isFree: true },
    { name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', tier: 'balanced', isFree: false },
  ],
  openrouter: [
    { name: MODEL_FAMILIES.CLAUDE_3_5_SONNET, displayName: MODEL_DISPLAY_LABELS[MODEL_FAMILIES.CLAUDE_3_5_SONNET], tier: 'balanced', isFree: false },
    { name: MODEL_FAMILIES.GPT_4O, displayName: MODEL_DISPLAY_LABELS[MODEL_FAMILIES.GPT_4O], tier: 'balanced', isFree: false },
    { name: MODEL_FAMILIES.DEEPSEEK_R1_FREE, displayName: 'DeepSeek R1', tier: 'balanced', isFree: true },
    { name: MODEL_FAMILIES.GEMINI_2_0_FLASH_FREE, displayName: 'Gemini 2.0 Flash', tier: 'fast', isFree: true },
  ],
  dashscope: [
    // 千问
    { name: 'qwen3.5-plus', displayName: 'Qwen 3.5 Plus', tier: 'balanced', isFree: false },
    { name: 'qwen3-max-2026-01-23', displayName: 'Qwen 3 Max', tier: 'balanced', isFree: false },
    { name: 'qwen3-coder-next', displayName: 'Qwen 3 Coder Next', tier: 'fast', isFree: false },
    { name: 'qwen3-coder-plus', displayName: 'Qwen 3 Coder Plus', tier: 'fast', isFree: false },
    // 智谱
    { name: 'glm-5', displayName: 'GLM 5', tier: 'balanced', isFree: false },
    { name: 'glm-4.7', displayName: 'GLM 4.7', tier: 'balanced', isFree: false },
    // Kimi
    { name: 'kimi-k2.5', displayName: 'Kimi K2.5', tier: 'balanced', isFree: false },
    // MiniMax
    { name: 'MiniMax-M2.5', displayName: 'MiniMax M2.5', tier: 'balanced', isFree: false },
  ],
};

/**
 * Sort models for UI display using the shared engine logic.
 */
export function sortModels(
  models: SortableModel[],
  _selectedModel?: string // Kept for API compatibility, though current sort is static
): SortableModel[] {
  return sortModelsGeneric(models);
}
