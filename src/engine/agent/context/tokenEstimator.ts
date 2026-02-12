/**
 * @file tokenEstimator.ts
 * @description Unified token estimation with Chinese character support.
 */

import { CONTEXT_CONSTANTS } from './constants';

/**
 * Token estimation with Chinese character support.
 * 1 Chinese char ≈ 2.0 tokens (empirical value for Gemini/Vertex)
 * English/Code ≈ 4 characters per token
 */
export function estimateTokens(content: string | any[]): number {
  if (content === null || content === undefined) return 0;
  
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  
  // count Chinese characters separately
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  
  const chineseTokens = Math.ceil(chineseChars * CONTEXT_CONSTANTS.ESTIMATION_CHINESE_CHAR_MULTIPLIER);
  const otherTokens = Math.ceil(otherChars / CONTEXT_CONSTANTS.ESTIMATION_CHARACTERS_PER_TOKEN);
  
  return chineseTokens + otherTokens;
}
