/**
 * @file errorCategorizer.ts
 * @description The "Engine" for categorizing raw error messages into UI actions.
 * 
 * Logic-only layer. Receives raw strings, returns semantic categories.
 */

import { ERROR_CATEGORIES, DEFAULT_ERROR_CATEGORY, ErrorActionType } from '../../config/errorPatterns';

export interface CategorizedError {
  i18nKey: string;
  handler: ErrorActionType;
}

/**
 * Categorize a raw error message into a structured UI configuration.
 * Generic engine that iterates over configured patterns.
 */
export function categorizeError(errorMsg: string): CategorizedError {
  const lower = errorMsg.toLowerCase();
  
  for (const category of ERROR_CATEGORIES) {
    if (category.pattern.test(lower)) {
      return {
        i18nKey: category.id,
        handler: category.handler
      };
    }
  }
  
  return {
    i18nKey: DEFAULT_ERROR_CATEGORY.id,
    handler: DEFAULT_ERROR_CATEGORY.handler
  };
}
