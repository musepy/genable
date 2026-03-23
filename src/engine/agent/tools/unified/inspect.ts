/**
 * @file inspect.ts
 * @description First-class `inspect` tool — structured read for design nodes.
 *
 * Combines ls (listing), tree (structure), and cat (detail) into one tool
 * with a `mode` parameter. Eliminates CLI string parsing for reads.
 */

import type { ToolDefinition } from '../types';

export const inspectDefinition: ToolDefinition = {
  name: 'inspect',
  category: 'read',
  executionStrategy: 'parallel',
  display: { displayName: 'Inspect', group: 'read' },
  description: `Inspect the design tree — list children, view structure, or read full properties.

Parameters:
  node: Node ref. Use "/" for page root, or "name#id" from jsx/inspect results (e.g. "Card#1:2").
  mode: "list" (children), "tree" (structure skeleton), "detail" (full properties). Default: "list"
  screenshot: Capture visual screenshot (detail mode only). Default: false
  depth: Max tree depth (default: 5, max: 10)

Examples:
  inspect({node: "/"})                                                → list page root
  inspect({node: "Card#100:5", mode: "tree"})                        → structural skeleton
  inspect({node: "Card#100:5", mode: "tree", depth: 2})              → shallow tree
  inspect({node: "Header#100:6", mode: "detail"})                    → full properties
  inspect({node: "Card#100:5", mode: "detail", screenshot: true})    → properties + screenshot`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Node ref. "/" for page root, "name#id" for specific node.' },
      mode: { type: 'string', description: '"list" (default), "tree", or "detail"' },
      screenshot: { type: 'boolean', description: 'Capture screenshot (detail mode only)' },
      depth: { type: 'number', description: 'Max depth (default: 5, max: 10)' },
    },
    required: ['node'],
  },
};
