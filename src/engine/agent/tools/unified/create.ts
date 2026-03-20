/**
 * @file create.ts
 * @description First-class `create` tool — structured JSON for design tree creation.
 *
 * Unlike `run({command: "mk ..."})` which requires CLI string parsing,
 * `create` takes a JSON array of node objects directly from the LLM's tool call.
 * The tool call framework validates the JSON — no custom string parsing needed.
 */

import type { ToolDefinition } from '../types';

export const createDefinition: ToolDefinition = {
  name: 'create',
  category: 'create',
  executionStrategy: 'sequential',
  display: { displayName: 'Create', group: 'create' },
  description: `Create a design tree from structured node objects. Each node specifies its tag, name, parent, and design properties.

Parameters:
  nodes: Array of node objects. Each node:
    - tag: "frame" | "text" | "rect" | "ellipse" | "line" | "icon" | "image" | "instance" | "component"
    - name: Display name (also used as parent reference target)
    - parent: Parent node's name (omit for root-level nodes)
    - content: Text content (for text nodes)
    - ref: Component name (for instances), variant: Variant selector
    - All other fields are design props: w, h, layout, gap, p, bg, corner, fill, size, weight, stroke, shadow, etc.

  parentId: Optional Figma node ID to create under.

Example:
  create({nodes: [
    {tag: "frame", name: "Card", w: 400, layout: "column", p: 24, bg: "#FFF", corner: 12},
    {tag: "frame", name: "Header", parent: "Card", layout: "row", gap: 12, w: "fill"},
    {tag: "text", name: "Title", parent: "Header", size: 18, weight: "Bold", fill: "#111", content: "John Doe"},
    {tag: "text", name: "Bio", parent: "Card", size: 14, fill: "#666", w: "fill", content: "Software engineer"}
  ]})

Rules:
  - Nodes processed in order — parent must appear before its children
  - Duplicate names: last one wins for parent references
  - Unresolved parent → created at page root
  - Props use same shorthands as mk: w, h, bg, p, gap, corner, fill, size, weight, etc.`,
  parameters: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: 'Array of node objects to create',
        items: {
          type: 'object',
          description: 'A node object with tag, name, parent reference, and design props',
          properties: {
            tag: { type: 'string', description: 'Node type: frame, text, rect, ellipse, line, icon, image, instance, component' },
            name: { type: 'string', description: 'Display name and parent reference target' },
            parent: { type: 'string', description: 'Parent node name (omit for root)' },
            content: { type: 'string', description: 'Text content (for text/icon nodes)' },
            ref: { type: 'string', description: 'Component name (for instances)' },
            variant: { type: 'string', description: 'Variant selector (for instances)' },
          },
          required: ['tag', 'name'],
        },
      },
      parentId: {
        type: 'string',
        description: 'Parent Figma node ID to create under (optional)',
      },
    },
    required: ['nodes'],
  },
};
