/**
 * @file promptRegistry.ts
 * @description Single source of truth for ALL prompt fragments.
 *
 * CATALOG KEYS (from src/prompts/*.md → prompt-catalog.json):
 *   SYSTEM — Identity, environment, scene graph, design thinking, conventions (WHAT & WHY)
 *
 * Procedures (HOW) live in src/prompts/help/*.md and are retrieved on demand
 * via the `knowledge` tool — they are NOT baked into the static system prompt.
 *
 * RULES:
 * 1. ALL prompt text the LLM sees MUST come from the catalog (or be re-exported here).
 * 2. Consumers import from this file. Never hard-code prompt text elsewhere.
 */

import catalog from '../../generated/prompt-catalog.json';

/** System prompt — identity + knowledge + rules (WHAT & WHY) */
export const SYSTEM = (catalog as any).SYSTEM as string;

