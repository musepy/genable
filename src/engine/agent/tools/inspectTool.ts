/**
 * @file inspectTool.ts
 * @description Unified inspection tool for Figma design state.
 * Consolidates: getSelection, getDeepHierarchy, getNodeDSL
 */

import { ToolDefinition } from './types';

/**
 * Unified inspection tool - reduces tool count and simplifies LLM decision making.
 */
export const inspectDesignDefinition: ToolDefinition = {
  name: 'inspectDesign',
  category: 'read',
  dependencies: [],
  description: `
[SUPER TOOL] Unified read tool for Figma state.

MODE OPTIONS:
- "selection": Get currently selected nodes (names, types, IDs)
- "hierarchy": Get full DSL tree of a node and children (requires nodeId)
- "node": Get DSL of a single node (requires nodeId)

REPLACES: getSelection, getDeepHierarchy, getNodeDSL
Use this instead of those tools.
`,
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['selection', 'hierarchy', 'node'],
        description: 'What to inspect'
      },
      nodeId: {
        type: 'string',
        description: 'Required for hierarchy/node modes. ID of node to inspect.'
      },
      depth: {
        type: 'number',
        description: 'For hierarchy mode: max depth (default 5, max 10)'
      }
    },
    required: ['mode']
  },
  executionStrategy: 'parallel',
  modes: ['PLANNING', 'EXECUTION', 'VERIFICATION', 'RECOVERY']
};
