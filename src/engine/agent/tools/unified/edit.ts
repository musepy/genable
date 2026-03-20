/**
 * @file edit.ts
 * @description First-class `edit` tool — structured property updates on existing nodes.
 *
 * Unlike mk (which upserts), edit requires the node to exist.
 * Takes props as a JSON object, not CLI tokens.
 */

import type { ToolDefinition } from '../types';

export const editDefinition: ToolDefinition = {
  name: 'edit',
  category: 'modify',
  executionStrategy: 'sequential',
  display: { displayName: 'Edit', group: 'design' },
  description: `Update properties or text content of an existing node.

Parameters:
  path: Path to existing node (must exist — fails if not found)
  props: Properties to update as key-value object (same shorthands: w, h, bg, corner, fill, size, weight, layout, gap, p, etc.)
  content: New text content (for text nodes)

Examples:
  edit({path: "/Card/", props: {corner: 16, bg: "#F8F9FA", p: 24}})
  edit({path: "/Card/Title", content: "Updated Title"})
  edit({path: "/Card/Title", props: {size: 20, weight: "Bold"}, content: "New Text"})
  edit({path: "/Card/Button/", props: {bg: "#4F46E5", corner: 8}})

Rules:
  - Node MUST exist — edit never creates new nodes
  - Only listed props change — everything else is preserved
  - Use jsx for creation, edit for modification`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to existing node' },
      props: { type: 'object', description: 'Properties to update (key-value pairs)' },
      content: { type: 'string', description: 'New text content (for text nodes)' },
    },
    required: ['path'],
  },
};
