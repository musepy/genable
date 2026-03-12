import { ToolDefinition } from '../types';

/**
 * Context tool — focused canvas context around a specific node.
 * Requires nodeId. Returns page metadata + target node skeleton + selection.
 */
export const contextDefinition: ToolDefinition = {
  name: 'context',
  category: 'read',
  display: { displayName: 'Context', group: 'inspect' },
  description: `Get canvas context for a specific node — page metadata, the node's structural skeleton (depth 2), and current user selection.

Requires a nodeId. Returns the target node's shallow structure plus page-level info (name, childCount, top-level node names) and any currently selected nodes.

Use this as your entry point when you have a nodeId (from a Figma URL or previous tool call).
If you don't have a nodeId, use outline() on the page root or inspect the user's selection.

Returns: { page: { name, childCount, topLevelNodes }, tree (target node skeleton), selection? }`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'Target node ID. Required.',
      },
      depth: {
        type: 'number',
        description: 'Max depth for hierarchy traversal (default: 2, max: 5).',
        minimum: 1,
        maximum: 5,
      },
    },
    required: ['nodeId']
  },
  executionStrategy: 'parallel',
  errors: {
    'NODE_NOT_FOUND': 'The specified nodeId does not exist.',
    'INVALID_NODE_TYPE': 'The nodeId refers to a non-scene node (e.g. Page or Document).',
  },
};
