/**
 * @file semanticMap.ts
 * @description Logic to map semantic intents to library components.
 */

import { LibraryResource } from '../types';

export interface SemanticMapping {
  token: string;
  keywords: string[];
  weight: number;
}

export const SEMANTIC_DEFINITIONS: SemanticMapping[] = [
  { token: 'BUTTON', keywords: ['button', 'btn', 'action'], weight: 10 },
  { token: 'ICON_BUTTON', keywords: ['iconbutton', 'icon-button', 'btn-icon'], weight: 12 },
  { token: 'AVATAR', keywords: ['avatar', 'profile', 'user-pic'], weight: 15 },
  { token: 'CARD', keywords: ['card', 'panel', 'surface'], weight: 8 },
  { token: 'BADGE', keywords: ['badge', 'tag', 'chip', 'label'], weight: 10 },
];

/**
 * Find the best matching library component for a given semantic token.
 */
export function findBestComponentMatch(
  semantic: string,
  availableComponents: LibraryResource[]
): LibraryResource | null {
  const target = SEMANTIC_DEFINITIONS.find(d => d.token === semantic.toUpperCase());
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
        score += 10;
        // Exact match bonus
        if (nameLower === kw) score += 20;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = comp;
    }
  }

  // Minimum threshold to prevent false positives
  return highestScore >= 10 ? bestMatch : null;
}
