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
  rawJson?: string;
  cleanedText?: string;
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
    const direct = tryParseJSON(cleaned, cleaned);
    if (direct.success) {
      return direct;
    }
    const extracted = extractJsonBlock(cleaned);
    if (extracted && extracted !== cleaned) {
      return tryParseJSON(extracted, cleaned);
    }
    return direct;
  }

  const extracted = extractJsonBlock(cleaned);
  if (extracted) {
    return tryParseJSON(extracted, cleaned);
  }

  return {
    success: false,
    error: 'Failed to find valid JSON in response',
    cleanedText: cleaned
  };
}

/**
 * Try to parse as JSON with coercion
 */
function tryParseJSON(text: string, cleanedText: string): ParseResult {
  try {
    const data = JSON.parse(text);
    return {
      success: true,
      data,
      format: 'json',
      rawJson: text,
      cleanedText
    };
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
      rawJson: text,
      cleanedText
    };
  }
}

function extractJsonBlock(text: string): string | null {
  const startIndex = text.search(/[\[{]/);
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === '\\') {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      depth++;
      continue;
    }

    if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

import { estimateTokens } from '../agent/context/tokenEstimator';
export { estimateTokens };
