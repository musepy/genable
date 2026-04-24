/**
 * @file inspect.ts
 * @description First-class `inspect` tool — structured read for design nodes.
 *
 * Facet model: pass `facets:[...]` to pick exactly which property buckets
 * to surface. No facets → skeleton structure only.
 *
 * For visual verification use the standalone `get_screenshot` tool.
 */

import type { ToolDefinition } from '../types';

export const inspectDefinition: ToolDefinition = {
  name: 'inspect',
  executionStrategy: 'parallel',
  description: `Read design node(s) — choose what to surface with \`facets\`.

Default (no facets) returns a skeleton: id, name, type, role, children.
For anything else, list the facets you need — nothing else is included.

Facets:
  structure   name, type, size, layout shorthand — cheap overview
  layout      layoutMode/gap/padding/align/sizing (row/column, fill/hug, etc.)
  paint|fill  fills + Paint.boundVariables.color (see bound tokens)
  stroke      strokes, strokeWeight, strokeAlign, dashPattern
  effects     shadows, blurs
  typography|text  fontFamily, fontSize, fontWeight, lineHeight, letterSpacing
  appearance  opacity, visible, blendMode, cornerRadius, clipsContent
  variables   node-level boundVariables + explicitVariableModes (token bindings)
  all         everything

Parameters:
  node    "/" for page root, or node ID from jsx/inspect results (e.g. "100:5").
  facets  array of facet names listed above.
  depth   Max tree depth (default: 5, max: 10).

Examples:
  inspect({node: "/"})                                   → page skeleton
  inspect({node: "100:5"})                               → one-node skeleton
  inspect({node: "100:5", facets: ["variables"]})        → token bindings only
  inspect({node: "100:5", facets: ["layout", "paint"]})  → layout + fills
  inspect({node: "100:5", facets: ["all"]})              → full properties

Use \`get_screenshot\` for visual verification. Use \`describe\` for lint/validation.`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: '"/" for page root, or node ID (e.g. "100:5").' },
      facets: {
        type: 'array',
        items: {
          type: 'string',
          description: 'A single facet name.',
          enum: ['structure', 'paint', 'layout', 'text', 'effects', 'variables', 'appearance', 'stroke', 'fill', 'typography', 'all'],
        },
        description: 'Property buckets to surface. Omit for a skeleton-only response.',
      },
      depth: { type: 'number', description: 'Max depth (default: 5, max: 10)' },
    },
    required: ['node'],
  },
};
