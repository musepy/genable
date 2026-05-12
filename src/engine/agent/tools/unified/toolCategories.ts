/**
 * @file toolCategories.ts
 * @description Split the tool catalog into HIGH-FREQ (full description in
 * the static system prompt) and MENU (one-line summary; full description
 * fetched on demand via the `tool_search` tool).
 *
 * Why: the static prompt's serialized tool list is redundant with the
 * provider's `tools` API — both carry the same name+description. Showing all
 * 38+ tools in full doubles the cached prefix bytes without adding new info
 * for the model. Splitting cuts ~15-18K chars off the static prompt while
 * keeping high-frequency tools fully visible at high attention positions.
 *
 * `tool_search` is registered as HIGH-FREQ so the model always knows how
 * to pull a menu tool's full description into recent context when needed.
 */

import type { ToolDefinition } from '../types';

/**
 * Tools rendered with full description in the static system prompt.
 *
 * Selection criteria:
 *   - Called every turn or near-every-turn (jsx, edit, inspect, session_note).
 *   - Cheap descriptions (knowledge readers, set_text, create_instance) — no
 *     win from putting them on the menu.
 *   - Discovery-critical (knowledge readers): missing one breaks the
 *     "read skill/style/guideline before designing" loop.
 *   - tool_search itself — model must always know how to fetch menu tools.
 */
export const HIGH_FREQ_TOOL_NAMES = new Set<string>([
  // Core CRUD
  'jsx',
  'edit',
  'inspect',
  'describe',
  // Search / navigation (cheap + commonly first)
  'find_nodes',
  // Components
  'create_instance',
  // Setters (most-used)
  'set_text',
  // Visual verification
  'get_screenshot',
  // Scratchpad — read/written every turn
  'session_note',
  // Knowledge discovery — short already, critical for first-call routing
  'skill',
  'style',
  'guideline',
  'help',
  // Menu router — must be visible in full
  'tool_search',
]);

/**
 * Override the auto-derived first-line summary for menu tools where the
 * first sentence isn't a good standalone hook. Empty by default — extend
 * after observing real menu output.
 */
export const LOW_FREQ_SUMMARY_OVERRIDES: Record<string, string> = {};

/**
 * Derive a single-line menu summary for a low-frequency tool.
 * Trims to first sentence (or first line) and caps at 180 chars.
 */
export function deriveMenuSummary(tool: ToolDefinition): string {
  const override = LOW_FREQ_SUMMARY_OVERRIDES[tool.name];
  if (override) return override;

  const firstLine = tool.description.split('\n')[0].trim();
  // Prefer first sentence when the line is multi-sentence
  const sentenceMatch = firstLine.match(/^(.+?[.!?])(?:\s|$)/);
  let summary = sentenceMatch ? sentenceMatch[1] : firstLine;
  if (summary.length > 180) {
    summary = summary.slice(0, 177).trimEnd() + '…';
  }
  return summary;
}
