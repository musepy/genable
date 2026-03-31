/**
 * @file knowledgeTool.ts
 * @description Query design guidelines, style guides, and help documentation.
 *
 * Replaces: man (from `run` CLI).
 * Executes locally in sandbox — no IPC.
 */

import { ToolDefinition } from '../types';

export const knowledgeDefinition: ToolDefinition = {
  name: 'knowledge',
  executionStrategy: 'parallel',
  description: `Query design guidelines, style guides, and help documentation.

Sources:
  help       — help articles and skill documentation (default)
  guidelines — design guidelines by topic
  style-tags — list available visual style tags
  style      — get a style guide by tags

Examples:
  knowledge({topic: "components"})
  knowledge({topic: "variants"})
  knowledge({source: "guidelines", topic: "dashboard"})
  knowledge({source: "guidelines", topic: "form"})
  knowledge({source: "style-tags"})
  knowledge({source: "style", tags: "dark-mode,minimal"})

Guidelines topics: dashboard, form, landing-page, card-layout, navigation, mobile, table, chart.`,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: '"help" (default), "guidelines", "style-tags", or "style"',
        enum: ['help', 'guidelines', 'style-tags', 'style'],
      },
      topic: {
        type: 'string',
        description: 'Help topic or guidelines context',
      },
      tags: {
        type: 'string',
        description: 'Comma-separated style tags (style source only)',
      },
    },
  },
};
