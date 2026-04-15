/**
 * @file modelFilter.ts
 * @description Model filtering logic for Gemini API
 * 
 * Strict model filtering: Only Gemini 3.0 and 2.5 Pro/Flash models
 */

import { MODEL_PATTERNS, DASHSCOPE_CONFIG } from './config';

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
 * Rule-based free model detection for Gemini.
 * Google API doesn't return pricing info, so we infer from naming patterns.
 * Historically stable rule: Flash/Lite = free tier, Pro = paid only.
 */
export function isLikelyFreeGeminiModel(modelName: string): boolean {
  const name = modelName.toLowerCase();
  // Pro models are paid-only (no free tier)
  if (/\bpro\b/.test(name)) return false;
  // Flash and Lite variants are always free-tier eligible
  if (/\b(flash|lite)\b/.test(name)) return true;
  // Unknown variant — conservative default: not free
  return false;
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
    .map((m: RawGeminiModel) => {
      const name = m.name.replace('models/', '');
      return {
        name,
        displayName: m.displayName || m.name,
        isFree: isLikelyFreeGeminiModel(name),
      };
    })
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
 * DashScope models — static list only (API endpoint has no CORS headers,
 * can't be called from plugin sandbox iframe)
 */
export async function fetchDashScopeModels(_apiKey: string): Promise<LLMModel[]> {
  return [];
}

/**
 * Claude models — static list (Anthropic models API requires auth, return curated list)
 */
export async function fetchClaudeModels(apiKey: string): Promise<LLMModel[]> {
  // Native Anthropic key (sk-ant-) → native Claude models
  // DashScope key → DashScope models via Anthropic-compatible endpoint
  const isNative = apiKey.startsWith('sk-ant-');
  if (isNative) {
    return [
      { name: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
      { name: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet' },
      { name: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku' },
    ];
  }
  // DashScope Anthropic-compatible models
  return [
    { name: 'kimi-k2.5', displayName: 'Kimi K2.5' },
    { name: 'qwen3-coder-plus', displayName: 'Qwen3 Coder Plus' },
    { name: 'qwen3-max', displayName: 'Qwen3 Max' },
    { name: 'qwen3.5-plus', displayName: 'Qwen3.5 Plus' },
    { name: 'qwen3-coder-flash', displayName: 'Qwen3 Coder Flash' },
  ];
}

/**
 * Unified model fetcher
 */
export async function fetchModels(provider: 'gemini' | 'openrouter' | 'dashscope' | 'claude', apiKey: string): Promise<LLMModel[]> {
  if (provider === 'gemini') {
    return fetchGeminiModels(apiKey);
  }
  if (provider === 'openrouter') {
    return fetchOpenRouterModels(apiKey);
  }
  if (provider === 'dashscope') {
    return fetchDashScopeModels(apiKey);
  }
  if (provider === 'claude') {
    return fetchClaudeModels(apiKey);
  }
  // Unknown provider — never send API key to wrong endpoint
  console.warn(`[modelFilter] Unknown provider: ${provider}, returning empty model list`);
  return [];
}

import { supportsThinkingMode } from './modelEngine';

/**
 * Detect if model supports Thinking Mode (Gemini 3.0+)
 */
export function isGemini3Model(modelName: string): boolean {
  return supportsThinkingMode(modelName);
}

