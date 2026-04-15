/**
 * @file knowledgeTool.ts
 * @description Knowledge tool — load a library entry by id.
 *
 * Single parameter: pass the id, get the full content.
 * The full menu (id + description) is in the system prompt.
 * No search action — the LLM picks from the menu directly.
 */

import { ToolDefinition } from '../types';

export const knowledgeDefinition: ToolDefinition = {
  name: 'knowledge',
  executionStrategy: 'parallel',
  description: `Load a knowledge entry from the library.

The FULL knowledge menu is in your system context under "## KNOWLEDGE LIBRARY".

Load via \`read\` when (a) the prompt names a style or component you have not just used, (b) the design type (mobile, form, dashboard) is one with a dedicated guideline, or (c) you need a values list (color tokens, type scale). Use \`search\` only when the id is unknown.

Examples:
  knowledge("style:neon-cyber")
  knowledge("anatomy:data-table")
  knowledge("help:interaction-model")
  knowledge("guideline:form")`,
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The entry id from the KNOWLEDGE LIBRARY menu, e.g. "neon-cyber", "anatomy:button", "help:interaction-model"',
      },
    },
    required: ['id'],
  },
};
