/**
 * @file dynamicContext.ts
 * @description Per-iteration dynamic context builder.
 *
 * Produces a tiny string that goes into a system-role message at index 1
 * (after the static system prompt at index 0).
 * This message is updated in-place each iteration — the static system prompt
 * at index 0 is never touched, enabling KV-cache reuse.
 */

/** Stable message ID used to locate and update the dynamic context message. */
export const DYNAMIC_CONTEXT_MSG_ID = 'dynamic-ctx';

/**
 * Build the per-iteration dynamic context content.
 *
 * @param iteration - Current iteration number (0-based)
 * @param maxIterations - Maximum iteration budget
 */
export function buildDynamicContextContent(
    iteration: number,
    maxIterations: number,
): string {
    return `[Iteration ${iteration + 1}/${maxIterations}]`;
}
