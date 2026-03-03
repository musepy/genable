import { ToolDefinition } from '../types';

/**
 * Unified delete tool — thin wrapper around existing deleteNode.
 */
export const deleteNodeDefinition: ToolDefinition = {
  name: 'delete_node',
  category: 'modify',
  display: { displayName: 'Delete Node', group: 'design' },
  dependencies: ['read_node'],
  description: `Delete a node from the Figma document. The node and all its children will be permanently removed.

IMPORTANT: Use read_node first to confirm the nodeId is correct.`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'Figma node ID to delete.'
      }
    },
    required: ['nodeId']
  },
  executionStrategy: 'sequential',
  errors: {
    'NODE_NOT_FOUND': 'The specified nodeId does not exist.'
  }
};
