/**
 * @file errorPatterns.ts
 * @description Declarative error categorization mapping.
 *
 * Only USER-ACTIONABLE errors get an ErrorBanner.
 * Agent-internal errors (network, stream, malformed, empty) are routed
 * through the agent's status channel by AgentOrchestrator.
 */

export type ErrorActionType = 'openSettings' | 'dismiss' | 'retry';

/**
 * Error categories that require the user to take action.
 * Everything else is handled silently by the agent loop.
 * Order matters: first match wins.
 */
export const ERROR_CATEGORIES = [
  {
    id: 'unauthorized',
    pattern: /api.?key|401|unauthorized/i,
    handler: 'openSettings' as ErrorActionType,
  },
  {
    id: 'rateLimited',
    pattern: /rate.?limit|temporarily|RATE_LIMIT_EXHAUSTED/i,
    handler: 'retry' as ErrorActionType,
  },
  {
    id: 'quotaExceeded',
    pattern: /quota|billing|insufficient.?credits/i,
    handler: 'openSettings' as ErrorActionType,
  },
] as const;

export const DEFAULT_ERROR_CATEGORY = {
  id: 'unknown',
  handler: 'dismiss' as ErrorActionType,
} as const;
