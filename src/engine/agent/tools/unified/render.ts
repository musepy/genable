/**
 * @file render.ts
 * @description Tool definition for the `render` command.
 *
 * Semantic rendering: style tokens replace manual property specification.
 * LLM writes `card → h1: "Title"`, system resolves all Figma properties.
 */

import type { ToolDefinition } from '../types';

export const renderDefinition: ToolDefinition = {
  name: 'render',
  category: 'create',
  executionStrategy: 'sequential',
  display: { displayName: 'Render', group: 'create' },
  description: `Render designs using style tokens — semantic markup, zero manual properties.

Usage:
  run({command: "render", input: "card\\n  h1: \\"Dashboard\\"\\n  body: \\"Overview\\""})

Syntax (indentation = nesting):
  container-token [prop:override ...]
    text-token: "content"

**Text tokens**: h1, h2, h3, body, body-sm, caption, stat-value, stat-label, overline
**Container tokens**: page, card, row, column, section, chip

Examples:
  card
    h1: "Settings"
    body: "Manage your account"

  page
    row
      card
        stat-value: "1,234"
        stat-label: "Users"
      card
        stat-value: "$45.6K"
        stat-label: "Revenue"

Container overrides: row gap:24, card fill:#F8FAFC p:32

Use render for structured content. Use mk for custom/creative designs.`,
  parameters: {
    type: 'object',
    properties: {
      markup: {
        type: 'string',
        description: 'Indentation-based markup with style tokens',
      },
      parentId: {
        type: 'string',
        description: 'Parent node ID (optional)',
      },
    },
    required: ['markup'],
  },
};
