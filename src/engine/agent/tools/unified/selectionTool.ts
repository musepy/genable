/**
 * @file selectionTool.ts
 * @description Get the user's current Figma selection — opt-in, not auto-injected.
 *
 * The LLM calls this when it needs to know what's selected (edit/modify intent).
 * For new design requests, the LLM should NOT call this — just create fresh.
 */

import { ToolDefinition } from '../types';

export const getSelectionDefinition: ToolDefinition = {
  name: 'get_selection',
  executionStrategy: 'parallel',
  description: `Get the user's currently selected nodes in Figma.

Returns node names, types, and IDs of selected elements.
Call this ONLY when the user's intent involves modifying existing elements:
- "change this button", "update the card", "fix the spacing"
- References to "this", "the selected", "it"

Do NOT call for new design requests like "design a login page" — just create fresh.

Examples:
  get_selection()`,
  parameters: {
    type: 'object',
    properties: {},
  },
};
