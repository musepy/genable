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
  path: Node path ("/" for page root, "/Card/Header/" for nested nodes)
  mode: "list" (children), "tree" (structure skeleton), "detail" (full properties). Default: "list"
  screenshot: Capture visual screenshot (detail mode only). Default: false
  depth: Max tree depth (default: 5, max: 10)

Examples:
  inspect({path: "/"})                                                → list page root
  inspect({path: "/Card/", mode: "tree"})                             → structural skeleton
  inspect({path: "/Card/", mode: "tree", depth: 2})                   → shallow tree
  inspect({path: "/Card/Header/", mode: "detail"})                    → full properties
  inspect({path: "/Card/", mode: "detail", screenshot: true})         → properties + screenshot

Path syntax: "/" = page root, "/Card/" = by name, "Card#100:5" = by name#id (from ls/receipt).
Glob: /Card/Btn* matches children starting with "Btn".`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Node path. "/" for page root.' },
      mode: { type: 'string', description: '"list" (default), "tree", or "detail"' },
      screenshot: { type: 'boolean', description: 'Capture screenshot (detail mode only)' },
      depth: { type: 'number', description: 'Max depth (default: 5, max: 10)' },
    },
    required: ['path'],
  },
};
