/**
 * @file dynamicContext.ts
 * @description Per-iteration dynamic context builder.
 *
 * Produces a tiny string that goes into a system-role message at index 1
 * (after the static system prompt at index 0).
 * This message is updated in-place each iteration — the static system prompt
 * at index 0 is never touched, enabling KV-cache reuse.
 */

import type { AgentMode } from '../../../shared/protocol/agentRuntimeEvents';

/** Stable message ID used to locate and update the dynamic context message. */
export const DYNAMIC_CONTEXT_MSG_ID = 'dynamic-ctx';

/**
 * Build the per-iteration dynamic context content.
 *
 * @param mode - Current agent mode (determines which mode guidance to follow)
 * @param activeStep - The currently active plan step (if any)
 */
export function buildDynamicContextContent(
    mode: AgentMode,
    activeStep?: { title: string } | null
): string {
    const lines: string[] = [`[MODE: ${mode}]`];

    if (activeStep?.title) {
        lines.push(`Active step: "${activeStep.title}"`);
    }

    return lines.join('\n');
}
