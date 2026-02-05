/**
 * @file semanticMap.ts
 * @description Logic to map semantic intents to library components using declarative rules.
 */

import { LibraryResource } from '../types';
import { SEMANTIC_RULES } from './projectUIRegistry';

/**
 * Find the best matching library component for a given semantic token.
 */
export function findBestComponentMatch(
  semantic: string,
  availableComponents: LibraryResource[]
): LibraryResource | null {
  const rules = SEMANTIC_RULES?.rules || [];
  const settings = SEMANTIC_RULES?.settings || {
    match_score: 10,
    exact_match_bonus: 20,
    min_threshold: 10
  };

  const target = rules.find((d: any) => d.token === semantic.toUpperCase());
  if (!target) return null;

  let bestMatch: LibraryResource | null = null;
  let highestScore = 0;

  for (const comp of availableComponents) {
    // Narrow down to component-like types
    const isComponent = comp.type as string === 'COMPONENT';
    const isComponentSet = comp.type as string === 'COMPONENT_SET';
    
    if (!isComponent && !isComponentSet) continue;
    
    let score = 0;
    const nameLower = comp.name.toLowerCase();
    
    for (const kw of target.keywords) {
      if (nameLower.includes(kw)) {
        score += settings.match_score;
        // Exact match bonus
        if (nameLower === kw) score += settings.exact_match_bonus;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = comp;
    }
  }

  // Minimum threshold to prevent false positives
  return highestScore >= settings.min_threshold ? bestMatch : null;
}
