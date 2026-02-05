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
}

/**
 * Static model manifest - bundled at build time
 * Provides instant availability without API call.
 */
export const SUPPORTED_MODELS: Record<string, ModelConfig[]> = {
  gemini: [
    { name: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', tier: 'fast' },
    { name: MODEL_FAMILIES.GEMINI_2_5_FLASH, displayName: 'Gemini 2.5 Flash', tier: 'fast' },
    { name: MODEL_FAMILIES.GEMINI_2_5_PRO, displayName: 'Gemini 2.5 Pro', tier: 'balanced' },
    // Use 1.5 as common fallback
    { name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', tier: 'fast' },
    { name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', tier: 'balanced' },
  ],
  openrouter: [
    { name: MODEL_FAMILIES.CLAUDE_3_5_SONNET, displayName: MODEL_DISPLAY_LABELS[MODEL_FAMILIES.CLAUDE_3_5_SONNET], tier: 'balanced' },
    { name: MODEL_FAMILIES.GPT_4O, displayName: MODEL_DISPLAY_LABELS[MODEL_FAMILIES.GPT_4O], tier: 'balanced' },
    { name: MODEL_FAMILIES.DEEPSEEK_R1_FREE, displayName: 'DeepSeek R1', tier: 'balanced' },
    { name: MODEL_FAMILIES.GEMINI_2_0_FLASH_FREE, displayName: 'Gemini 2.0 Flash', tier: 'fast' },
  ]
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
