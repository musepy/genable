/**
 * @file describe.ts
 * @description First-class `describe` tool — semantic description + role detection + lint.
 *
 * Modeled after OpenPencil's describe: the LLM calls this explicitly to validate
 * a design subtree. Returns per-node semantic info + issues with severity.
 */

import type { ToolDefinition } from '../types';

export const describeDefinition: ToolDefinition = {
  name: 'describe',
  executionStrategy: 'parallel',
  description: `Validate a design subtree — semantic description, role detection, and lint rules.

Call after jsx() or edit() to check for layout conflicts, overflow, missing properties, and structural issues.

Parameters:
  node: Node ID to describe (e.g. "100:5"). Required.
  depth: How deep to check children (default: 3, max: 8).

Returns per-node: role, visual summary, layout summary, and issues (severity: error/warning/info).

Examples:
  describe({node: "100:5"})             → validate subtree, depth 3
  describe({node: "100:5", depth: 1})   → shallow check (root + direct children only)`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Node ID to describe (e.g. "100:5").' },
      depth: { type: 'number', description: 'Max depth to check (default: 3, max: 8)' },
    },
    required: ['node'],
  },
};
