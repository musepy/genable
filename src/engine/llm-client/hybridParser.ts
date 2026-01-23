/**
 * @file hybridParser.ts
 * @description Parser that handles JSON response from Gemini
 * 
 * Note: Historical "Hybrid" functionality (DSL fallback) has been removed
 * as the project now strictly uses Gemini's responseJsonSchema.
 */

import { NodeLayer, coerceNodeLayer } from '../../schema/layerSchema';

export interface ParseResult {
  success: boolean;
  data?: NodeLayer;
  format?: 'json';
  warnings?: string[];
  error?: string;
}

/**
 * Detect if text is likely JSON format
 */
function isJSONFormat(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Parse LLM output (strictly JSON)
 * 
 * @param text - Raw LLM output
 * @returns ParseResult with data or error
 */
export function parseHybrid(text: string): ParseResult {
  // Debug: Log raw input length and preview
  console.log('[HybridParser] Raw input length:', text.length);
  
  // Clean markdown code blocks
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Strategy: JSON only
  if (isJSONFormat(cleaned)) {
    return tryParseJSON(cleaned);
  }

  // Fallback if not starting with {
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return tryParseJSON(jsonMatch[0]);
  }

  return {
    success: false,
    error: 'Failed to find valid JSON in response',
  };
}

/**
 * Try to parse as JSON with coercion
 */
function tryParseJSON(text: string): ParseResult {
  try {
    const data = JSON.parse(text);
    return {
      success: true,
      data,
      format: 'json',
    };
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
    };
  }
}

/**
 * Get token estimate for a string
 * Rough approximation: ~4 chars per token for English/code
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
