/**
 * @file jsTool.ts
 * @description Execute JavaScript in the Figma plugin runtime.
 *
 * Replaces: run js (from `run` CLI).
 * Escape hatch — full access to figma.* API.
 */

import { ToolDefinition } from '../types';

export const jsToolDefinition: ToolDefinition = {
  name: 'js',
  category: 'control',
  display: { displayName: 'JavaScript', group: 'system' },
  executionStrategy: 'sequential',
  mutates: true,
  description: `Execute JavaScript in the Figma plugin runtime — full figma.* API access.

Use as escape hatch for operations not covered by other tools.

Examples:
  js({code: "figma.currentPage.children.length"})
  js({code: "figma.currentPage.findAll(n => n.type === 'TEXT').map(n => ({name: n.name, size: n.fontSize}))"})
  js({code: "figma.currentPage.selection.map(n => n.name)"})

Rules:
  - Full access to figma global (Figma Plugin API)
  - Use return for multi-statement code
  - Async/await supported
  - Results auto-serialized (nodes -> {id, type, name, width, height})
  - Arrays capped at 100 items`,
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute. Use return to output a value.',
      },
    },
    required: ['code'],
  },
  errors: {
    EMPTY_CODE: 'No code provided.',
    EXECUTION_ERROR: 'JavaScript execution failed.',
    BLOCKED_OPERATION: 'Operation blocked for safety.',
    FIGMA_API_ERROR: 'Figma API validation error.',
  },
};
