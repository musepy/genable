/**
 * @file idempotentApply.ts
 * @description Shared utilities for idempotent tool execution and plan step tracking.
 *
 * Extracted from toolCallHandler.ts to eliminate duplicated patterns:
 * - patchCache.shouldApply() check (was repeated 8 times)
 * - planState.completeTask() call (was repeated 16 times)
 */

import { patchCache, PatchFingerprint } from '../../engine/validation/patchCache';
import { planState } from '../../engine/agent/planState';

/**
 * Check if an operation should be skipped due to idempotency.
 * Returns a skip response if the operation was already applied.
 */
export function shouldSkipIdempotent(
  nodeId: string,
  category: keyof PatchFingerprint,
  data: any,
  stepId?: string
): { skip: true; response: { success: true; data: { nodeId: string } } } | { skip: false } {
  if (!patchCache.shouldApply(nodeId, category, data)) {
    if (stepId) planState.completeTask(stepId);
    return { skip: true, response: { success: true, data: { nodeId } } };
  }
  return { skip: false };
}

/**
 * Complete a plan step if stepId is provided.
 * Call after a successful tool execution.
 */
export function completeStep(stepId?: string): void {
  if (stepId) planState.completeTask(stepId);
}
