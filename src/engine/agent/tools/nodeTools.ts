import { ToolDefinition } from './types';

// ==========================================
// 6. deleteNode
// ==========================================

export const deleteNodeDefinition: ToolDefinition = {
  name: 'deleteNode',
  category: 'modify',
  dependencies: [],
  description: 'Remove a node from the document.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'ID of node to delete' }
    },
    required: ['nodeId']
  },
  executionStrategy: 'sequential',
  modes: ['EXECUTION']
};
