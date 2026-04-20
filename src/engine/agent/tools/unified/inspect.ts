/**
 * @file inspect.ts
 * @description First-class `inspect` tool — structured read for design nodes.
 *
 * Two modes:
 *   - tree (default): skeleton JSON with role, summary, progressive disclosure
 *   - detail: full properties, optional screenshot
 */

import type { ToolDefinition } from '../types';

export const inspectDefinition: ToolDefinition = {
  name: 'inspect',
  executionStrategy: 'parallel',
  description: `Inspect the design tree — view structure or read full properties.

Parameters:
  node: "/" for page root, or node ID from jsx/inspect results (e.g. "100:5").
  mode: "tree" (structure skeleton, default) or "detail" (full properties)
  depth: Max tree depth (default: 5, max: 10)
  screenshot: Capture visual screenshot (detail mode only). Default: false

Examples:
  inspect({node: "/"})                                          → page structure
  inspect({node: "/", depth: 1})                                → shallow overview
  inspect({node: "100:5", mode: "tree"})                        → structural skeleton
  inspect({node: "100:6", mode: "detail"})                      → full properties
  inspect({node: "100:5", mode: "detail", screenshot: true})    → properties + screenshot`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: '"/" for page root, or node ID (e.g. "100:5").' },
      mode: { type: 'string', enum: ['tree', 'detail'], description: 'tree = structure skeleton (default); detail = full properties' },
      depth: { type: 'number', description: 'Max depth (default: 5, max: 10)' },
      screenshot: { type: 'boolean', description: 'Capture screenshot (detail mode only)' },
    },
    required: ['node'],
  },
};
