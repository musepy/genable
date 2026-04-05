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
  description: `Search and read design knowledge, guidelines, and reference documentation.

Actions:
  search — find knowledge entries by keyword (returns name + description)
  read   — get full content by ID

Categories: guideline, help, skill, style, anatomy

Examples:
  knowledge({action: "search", query: "form"})
  knowledge({action: "search", query: "button component"})
  knowledge({action: "search", query: "dark mode style"})
  knowledge({action: "read", id: "guideline:form"})
  knowledge({action: "read", id: "anatomy:button"})
  knowledge({action: "read", id: "style:terminal-dark"})`,
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
