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
  node: Node ref. Use "/" for page root, or "name#id" from jsx/inspect results (e.g. "Card#1:2").
  mode: "tree" (structure skeleton, default) or "detail" (full properties)
  depth: Max tree depth (default: 5, max: 10)
  screenshot: Capture visual screenshot (detail mode only). Default: false
  score: Run quality scoring and return issues. Default: false

Examples:
  inspect({node: "/"})                                                → page structure
  inspect({node: "/", depth: 1})                                      → shallow overview
  inspect({node: "Card#100:5", mode: "tree"})                        → structural skeleton
  inspect({node: "Header#100:6", mode: "detail"})                    → full properties
  inspect({node: "Card#100:5", mode: "detail", screenshot: true})    → properties + screenshot
  inspect({node: "Card#100:5", score: true})                          → structure + quality score`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Node ref. "/" for page root, "name#id" for specific node.' },
      mode: { type: 'string', description: '"tree" (default) or "detail"' },
      depth: { type: 'number', description: 'Max depth (default: 5, max: 10)' },
      screenshot: { type: 'boolean', description: 'Capture screenshot (detail mode only)' },
      score: { type: 'boolean', description: 'Run quality scoring (default: false)' },
    },
    required: ['node'],
  },
};
