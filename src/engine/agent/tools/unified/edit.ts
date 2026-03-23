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
  node: Node ref from jsx/inspect results. Use "name#id" format (e.g. "Card#1:2").
  props: Properties to update as key-value object (same shorthands: w, h, bg, corner, fill, size, weight, layout, gap, p, etc.)
  content: New text content (for text nodes)

Examples:
  edit({node: "Card#100:5", props: {corner: 16, bg: "#F8F9FA", p: 24}})
  edit({node: "Title#100:6", content: "Updated Title"})
  edit({node: "Title#100:6", props: {size: 20, weight: "Bold"}, content: "New Text"})

Rules:
  - Node MUST exist — edit never creates new nodes
  - Only listed props change — everything else is preserved
  - Use name#id refs from jsx tree or inspect results — do NOT construct paths`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Node ref in "name#id" format from jsx/inspect results' },
      props: { type: 'object', description: 'Properties to update (key-value pairs)' },
      content: { type: 'string', description: 'New text content (for text nodes)' },
    },
    required: ['node'],
  },
};
