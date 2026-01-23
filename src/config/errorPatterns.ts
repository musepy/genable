/**
 * @file errorPatterns.ts
 * @description Declarative error categorization mapping.
 * 
 * Separates "What indicates an error" (Regex) from "How to handle it" (Handler).
 */

export type ErrorActionType = 'openModelSelector' | 'openSettings' | 'retry' | 'dismiss';

/**
 * Error categorizations mapping regex patterns to semantic types.
 */
export const ERROR_CATEGORIES = [
  {
    id: 'unauthorized',
    pattern: /api.?key|401|unauthorized/i,
    handler: 'openSettings' as ErrorActionType,
  },
  {
    id: 'notFound',
    pattern: /404|not.?found|model/i,
    handler: 'openModelSelector' as ErrorActionType,
  },
  {
    id: 'rateLimit',
    pattern: /rate.?limit|429|quota/i,
    handler: 'retry' as ErrorActionType,
  },
  {
    id: 'serverError',
    pattern: /50[0-3]|server/i,
    handler: 'retry' as ErrorActionType,
  },
  {
    id: 'network',
    pattern: /network|fetch|timeout/i,
    handler: 'retry' as ErrorActionType,
  }
] as const;

export const DEFAULT_ERROR_CATEGORY = {
  id: 'unknown',
  handler: 'dismiss' as ErrorActionType,
} as const;
