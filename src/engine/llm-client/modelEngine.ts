/**
 * @file modelEngine.ts
 * @description The "Engine" for model interpretation and processing.
 * 
 * Logic-only layer. Does not contain model lists or defaults.
 * Agnostic of specific deployments; interprets names based on patterns.
 */

/**
 * Extract version number from model name string.
 * @example 'gemini-2.5-flash' -> 2.5
 * @example 'models/gemini-1.5-pro-latest' -> 1.5
 */
export function extractModelVersion(modelName: string): number {
  const match = modelName.match(/gemini-(\d+\.?\d*)/i);
  if (match) {
    return parseFloat(match[1]);
  }
  return 0; // Unknown or legacy
}

/**
 * Extract model capability tier/priority.
 * Logic: Flash (high speed/iterative) > Pro (balanced) > Nano/Others.
 * @returns Priority score (higher = more preferred for primary designation)
 */
export function extractModelTierPriority(modelName: string): number {
  const name = modelName.toLowerCase();
  if (name.includes('flash')) return 2;
  if (name.includes('pro')) return 1;
  return 0;
}

/**
 * Determine if a model belongs to the Gemini 3.0+ family.
 * Used for feature flagging (e.g., Thinking Mode).
 * 
 * Robust Regex: Matches 'gemini-3', 'gemini-3.5', 'exp-3', etc.
 * Avoids false positives from 'gemini-1.3'.
 */
export function isGemini3Family(modelName: string): boolean {
  return /gemini-3(\.|\b)|-3-|^3-|exp-3/i.test(modelName);
}


/**
 * Model selection data shape for sorting
 */
export interface SortableModel {
  name: string;
  displayName: string;
}

/**
 * Higher-order sorting engine for model listings.
 * Follows: Version (DESC) -> Tier (DESC) -> Display Name (ASC).
 */
export function sortModelsGeneric(models: SortableModel[]): SortableModel[] {
  return [...models].sort((a, b) => {
    // 1. Version Comparison
    const versionA = extractModelVersion(a.name);
    const versionB = extractModelVersion(b.name);
    if (versionB !== versionA) return versionB - versionA;

    // 2. Tier Comparison
    const tierA = extractModelTierPriority(a.name);
    const tierB = extractModelTierPriority(b.name);
    if (tierB !== tierA) return tierB - tierA;

    // 3. Alphabetical Fallback
    return a.displayName.localeCompare(b.displayName);
  });
}
