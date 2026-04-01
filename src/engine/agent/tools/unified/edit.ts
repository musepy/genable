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
  description: `Batch update properties on multiple nodes. Use after inspect to fix multiple issues at once.

For single-property changes, prefer focused setters:
  set_text  — text content
  set_fill  — fill/background color
  set_stroke — border
  set_layout — padding, gap, direction

Use edit for batch fixes or properties not covered by setters (sizing, radius, opacity, effects, component props):
  edit({nodes: [
    {node: "1:1", props: {w: "fill", corner: 8}},
    {node: "1:2", props: {opacity: 0.6}},
    {node: "1:3", content: "Updated text"},
    {node: "1:4", props: {Name: "Alex", Role: "Engineer"}}
  ]})`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Node ID (e.g. "1:2") from jsx/inspect results' },
      nodes: { type: 'array', description: 'Batch: array of {node, props?, content?} objects', items: { type: 'object', description: '{node, props?, content?}' } },
      props: { type: 'object', description: 'Properties to update (single mode)' },
      content: { type: 'string', description: 'New text content (single mode)' },
    },
  },
};
