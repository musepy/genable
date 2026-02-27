/**
 * @file modelFilter.ts
 * @description Model filtering logic for Gemini API
 * 
 * Strict model filtering: Only Gemini 3.0 and 2.5 Pro/Flash models
 */

import { MODEL_PATTERNS } from './config';

/**
 * Raw model data from Gemini API
 */
export interface RawGeminiModel {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

/**
 * Cleaned model data for UI consumption
 */
export interface LLMModel {
  name: string;
  displayName: string;
  isFree?: boolean;
}

/**
 * Check if a model is Pro or Flash variant
 */
function isAllowedVariant(name: string, displayName: string): boolean {
  const combined = `${name} ${displayName}`.toLowerCase();
  return MODEL_PATTERNS.VARIANT.test(combined);
}

/**
 * Check if model contains excluded keywords
 */
function hasExcludedKeyword(name: string, displayName: string): boolean {
  const combined = `${name} ${displayName}`.toLowerCase();
  return MODEL_PATTERNS.EXCLUDED_KEYWORDS.some(kw => combined.includes(kw));
}

/**
 * Model filtering: Gemini Pro/Flash models, excluding non-generation variants.
 * 
 * @param modelName - The model name (e.g., "gemini-2.5-flash")
 * @param displayName - Optional display name
 * @returns true if model should be shown in UI
 */
export function isAllowedModel(modelName: string, displayName?: string): boolean {
  const name = modelName.toLowerCase();
  const display = (displayName || '').toLowerCase();
  
  // Must be Pro or Flash
  if (!isAllowedVariant(name, display)) return false;
  
  // Must not have excluded keywords
  if (hasExcludedKeyword(name, display)) return false;
  
  return true;
}

/**
 * Fetch available Gemini models from API
 * 
 * @param apiKey - Gemini API key
 * @returns Filtered list of supported models
 */
export async function fetchGeminiModels(apiKey: string): Promise<LLMModel[]> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await response.json();
  
  if (!data.models) return [];
  
  return data.models
    .filter((m: RawGeminiModel) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: RawGeminiModel) => ({
      name: m.name.replace('models/', ''),
      displayName: m.displayName || m.name
    }))
    .filter((m: LLMModel) => isAllowedModel(m.name, m.displayName));
}

/**
 * Fetch available OpenRouter models from API
 */
export async function fetchOpenRouterModels(apiKey: string): Promise<LLMModel[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    }
  });
  const data = await response.json();
  
  if (!data.data) return [];
  
  // For OpenRouter, we might want to filter for specific high-quality models 
  // or just return all of them. For now, let's return all but prioritize 
  // ones used in our constants.
  return data.data.map((m: any) => {
    const isFree = m.pricing && m.pricing.prompt === "0" && m.pricing.completion === "0";
    return {
      name: m.id,
      displayName: m.name || m.id,
      isFree
    };
  });
}

/**
 * Unified model fetcher
 */
export async function fetchModels(provider: 'gemini' | 'openrouter', apiKey: string): Promise<LLMModel[]> {
  if (provider === 'openrouter') {
    return fetchOpenRouterModels(apiKey);
  }
  return fetchGeminiModels(apiKey);
}

import { supportsThinkingMode } from './modelEngine';

/**
 * Detect if model supports Thinking Mode (Gemini 3.0+)
 */
export function isGemini3Model(modelName: string): boolean {
  return supportsThinkingMode(modelName);
}

