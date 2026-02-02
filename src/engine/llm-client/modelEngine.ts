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
 * @example 'anthropic/claude-3.5-sonnet' -> 3.5
 */
export function extractModelVersion(modelName: string): number {
  const name = modelName.toLowerCase();
  
  // Gemini pattern
  const geminiMatch = name.match(/gemini-(\d+\.?\d*)/i);
  if (geminiMatch) return parseFloat(geminiMatch[1]);
  
  // Generic pattern (e.g., claude-3.5, gpt-4)
  const genericMatch = name.match(/(?:claude|gpt)-?(\d+\.?\d*)/i);
  if (genericMatch) return parseFloat(genericMatch[1]);
  
  return 0; // Unknown or legacy
}

/**
 * Extract model capability tier/priority.
 * Logic: Sonnet/Flash (high speed/iterative) > Pro/Opus (balanced) > Nano/Others.
 * @returns Priority score (higher = more preferred for primary designation)
 */
export function extractModelTierPriority(modelName: string): number {
  const name = modelName.toLowerCase();
  if (name.includes('flash') || name.includes('sonnet') || name.includes('4o')) return 2;
  if (name.includes('pro') || name.includes('opus')) return 1;
  return 0;
}

/**
 * Determine if a model belongs to the strict signature family (2.5 & 3.0+).
 * These models require exact thought_signature preservation.
 */
export function isStrictSignatureFamily(modelName: string): boolean {
  return /gemini-(?:2\.5|3)|exp-3/i.test(modelName);
}

/**
 * Determine if a model supports Thinking Mode (Gemini 3.0+).
 */
export function supportsThinkingMode(modelName: string): boolean {
  return /gemini-3(\.|\b)|-3-|^3-|exp-3/i.test(modelName);
}

/**
 * @deprecated Use isStrictSignatureFamily or supportsThinkingMode
 */
export function isGemini3Family(modelName: string): boolean {
  return supportsThinkingMode(modelName);
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
