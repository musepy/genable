/**
 * @file knowledgeTool.ts
 * @description Unified knowledge retrieval tool — search/read over all knowledge sources.
 *
 * Two actions:
 *   search — keyword search, returns [{id, name, description}] (lightweight)
 *   read   — full content by id
 *
 * Knowledge categories:
 *   guideline:*  — UI pattern design guidelines (form, dashboard, table, etc.)
 *   help:*       — tool usage guides and best practices
 *   skill:*      — advanced workflows (component sets, design systems, etc.)
 *   style:*      — visual style guides with color/typography tokens
 *   anatomy:*    — component structure blueprints (button, card, modal, etc.)
 */

import { ToolDefinition } from '../types';

export const knowledgeDefinition: ToolDefinition = {
  name: 'knowledge',
  executionStrategy: 'parallel',
  description: `Read a knowledge library entry by id (preferred) or search as a last resort.

The FULL knowledge library menu is already in your system context under "## KNOWLEDGE LIBRARY" — every entry's id and description is listed. Scan that menu and call \`read\` with the matching id directly. Do NOT guess keywords with \`search\` when the menu already shows what is available.

Actions:
  read   — fetch full content by id (primary usage — the menu is in your system context)
  search — keyword fallback; only use when you cannot locate the right id from the menu

Strong recommendations:
  • Before creating a new design, read at least one style entry (e.g. "style:neon-cyber") so your color/typography decisions come from the library, not your prior.
  • When building an unfamiliar component type, read the matching anatomy entry (e.g. "anatomy:data-table") before generating structure.
  • Reference tables ("ref:*") are CSV data — read them when you need concrete tokens (colors, fonts, chart recommendations).

Examples:
  knowledge({action: "read", id: "style:neon-cyber"})
  knowledge({action: "read", id: "anatomy:button"})
  knowledge({action: "read", id: "guideline:form"})
  knowledge({action: "read", id: "ref:colors"})
  knowledge({action: "search", query: "dashboard hero"})  // fallback only`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'read'],
        description: '"search" to find entries, "read" to get full content',
      },
      query: {
        type: 'string',
        description: 'Search keywords (for search action)',
      },
      id: {
        type: 'string',
        description: 'Knowledge entry ID like "guideline:form" (for read action)',
      },
    },
    required: ['action'],
  },
};
