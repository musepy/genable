/**
 * @file errorPatterns.ts
 * @description Declarative error categorization mapping.
 *
 * Only USER-ACTIONABLE errors get an ErrorBanner.
 * Agent-internal errors (network, stream, malformed, empty) are routed
 * through the agent's status channel by AgentOrchestrator.
 */

export type ErrorActionType = 'openSettings' | 'dismiss';

/**
 * Error categories that require the user to take action.
 * Everything else is handled silently by the agent loop.
 */
export const ERROR_CATEGORIES = [
  {
    id: 'unauthorized',
    pattern: /api.?key|401|unauthorized/i,
    handler: 'openSettings' as ErrorActionType,
  },
  {
    id: 'quotaExceeded',
    pattern: /quota|429|billing|rate.?limit/i,
    handler: 'openSettings' as ErrorActionType,
  },
] as const;

export const DEFAULT_ERROR_CATEGORY = {
  id: 'unknown',
  handler: 'dismiss' as ErrorActionType,
} as const;
