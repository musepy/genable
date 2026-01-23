/**
 * Recommended models configuration and sorting utilities
 * 
 * Architecture: "Static Manifest + Client Cache + SWR Refresh"
 * - SUPPORTED_MODELS: Bundled defaults (instant availability)
 * - Cache: Persisted in clientStorage (survive plugin restarts)
 * - SWR: Background refresh when cache > 24h stale
 */

import { sortModelsGeneric, SortableModel } from '../../engine/llm-client/modelEngine';

// [SSOT] Stable default for UI and fresh installations
export const DEFAULT_MODEL = 'gemini-2.5-flash';

/** [SSOT] Hard fallback for emergency recovery in main thread storage */
export const FALLBACK_MODEL = 'gemini-2.5-flash';

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
export const SUPPORTED_MODELS: ModelConfig[] = [
  { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', tier: 'fast' },
  { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', tier: 'balanced' },
  { name: 'gemini-2.5-flash-preview-05-20', displayName: 'Gemini 2.5 Flash Preview', tier: 'preview' },
  { name: 'gemini-2.5-pro-preview-05-06', displayName: 'Gemini 2.5 Pro Preview', tier: 'preview' },
];

/**
 * Sort models for UI display using the shared engine logic.
 */
export function sortModels(
  models: SortableModel[],
  _selectedModel?: string // Kept for API compatibility, though current sort is static
): SortableModel[] {
  return sortModelsGeneric(models);
}

