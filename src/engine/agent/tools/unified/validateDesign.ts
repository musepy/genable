import { ToolDefinition } from '../types';

/**
 * Unified validation tool — simplified version of validateLayout.
 */
export const validateDesignDefinition: ToolDefinition = {
  name: 'validate_design',
  category: 'validate',
  dependencies: ['create_node', 'patch_node'],
  description: `Validate a node's layout and design constraints. Checks for sizing conflicts, auto-layout issues, and other structural problems.

Use this after creating or modifying nodes to catch issues early.`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'Figma node ID to validate. Will validate the node and its children recursively.'
      }
    },
    required: ['nodeId']
  },
  executionStrategy: 'parallel',
  errors: {
    'NODE_NOT_FOUND': 'The specified nodeId does not exist.'
  }
};
