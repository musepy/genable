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

The FULL knowledge menu is in your system context under "## KNOWLEDGE LIBRARY". When an entry matches your task, this is a BLOCKING REQUIREMENT: load it BEFORE generating any other response about the task.

When to load:
  • Before creating a new design → load a style entry (e.g. "style:neon-cyber")
  • Before building an unfamiliar component → load the anatomy entry (e.g. "anatomy:button")
  • When the user's intent is vague or ambiguous → load "help:interaction-model"
  • When style is under-specified → load "help:style-collaboration"

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
