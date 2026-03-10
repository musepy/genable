import { ToolDefinition } from '../types';

/**
 * Context tool — canvas overview: page info, top-level skeleton, user selection.
 * No parameters needed. Call this first when you don't know what's on the canvas.
 */
export const contextDefinition: ToolDefinition = {
  name: 'context',
  category: 'read',
  display: { displayName: 'Context', group: 'inspect' },
  description: `Get a canvas overview — page name, top-level node skeleton (depth 2), and current user selection.

Call this FIRST when you don't know what's on the canvas. Returns a shallow structural skeleton of all top-level nodes plus any currently selected nodes.

No parameters needed.

Returns: { page: { name, childCount }, xml (top-level skeleton), selection? }`,
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  executionStrategy: 'parallel',
};
