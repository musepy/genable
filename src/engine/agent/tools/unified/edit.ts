/**
 * @file edit.ts
 * @description First-class `edit` tool — structured property updates on existing nodes.
 *
 * Unlike mk (which upserts), edit requires the node to exist.
 * Takes props as a JSON object, not CLI tokens.
 */

import type { ToolDefinition } from '../types';
import { keepFields } from './keepFields';

export const editDefinition: ToolDefinition = {
  name: 'edit',
  executionStrategy: 'sequential',
  mutates: true,
  presentForLLM: (data) => keepFields(data, ['id', 'name', 'type', 'updated', 'results', 'errors', 'partial']),
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
      nodes: {
        type: 'array',
        description: 'Batch: array of {node, props?, content?} objects. No hard item cap — real ceiling is LLM output stream length (~10KB+ of rendered params can stall mid-JSON). If a batch is large and props are rich, split into 2 calls.',
        items: {
          type: 'object',
          description: '{node, props?, content?} — at least one of props or content is required',
          properties: {
            node: { type: 'string', description: 'Node ID to update' },
            props: { type: 'object', description: 'Properties to update (object, not a stringified JSON)' },
            content: { type: 'string', description: 'New text content (for text nodes / overrides)' },
          },
          required: ['node'],
        },
      },
      props: { type: 'object', description: 'Properties to update (single mode)' },
      content: { type: 'string', description: 'New text content (single mode)' },
    },
  },
};
