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
  executionStrategy: 'sequential',
  mutates: true,
  description: `Update properties or text content of existing nodes. Supports single and batch.

Single:
  edit({node: "Card#1:2", props: {corner: 16, bg: "#F8F9FA"}})
  edit({node: "Title#1:3", content: "Updated Title"})

Batch (preferred when editing multiple nodes):
  edit({nodes: [
    {node: "Form#1:1", props: {w: "fill"}},
    {node: "Email Field#1:2", props: {w: "fill"}},
    {node: "Button#1:3", props: {bg: "#4F46E5", corner: 8}}
  ]})

Rules:
  - Nodes MUST exist — edit never creates
  - Only listed props change — everything else preserved
  - Use name#id refs from jsx tree or inspect results
  - Batch multiple edits into one call — do NOT call edit() per node`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Single node ref in "name#id" format' },
      nodes: { type: 'array', description: 'Batch: array of {node, props?, content?} objects', items: { type: 'object', description: '{node, props?, content?}' } },
      props: { type: 'object', description: 'Properties to update (single mode)' },
      content: { type: 'string', description: 'New text content (single mode)' },
    },
  },
};
