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
  description: `Batch update properties on multiple nodes.

For single-property changes, prefer focused setters:
  set_text  — text content
  set_fill  — fill/background color
  set_stroke — border
  set_layout — padding, gap, direction

Use edit for batch fixes or properties not covered by setters (sizing, radius, opacity, effects, component props):
  edit({nodes: [
    {node: "1:1", props: {w: "fill", corner: 8}},        // Figma native props
    {node: "1:2", props: {opacity: 0.6}},
    {node: "1:3", props: {Label: "Sign In"}},             // instance TEXT prop (by display name)
  ]})

For instances, use component property DISPLAY NAMES (e.g. "Label") — edit resolves them to Figma's internal keys automatically. Component props can be mixed with Figma props in the same call.`,
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
