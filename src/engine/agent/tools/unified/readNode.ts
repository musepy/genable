import { ToolDefinition } from '../types';

/**
 * Unified read tool — replaces inspectDesign, getSelection, getNodeDSL, getVariables, getStyles.
 * Single entry point for all Figma document queries.
 */
export const readNodeDefinition: ToolDefinition = {
  name: 'read_node',
  category: 'read',
  display: { displayName: 'Read Node', group: 'inspect' },
  description: `Read anything from the Figma document. This is the ONLY tool for querying the current canvas state.

Modes:
- "selection": Get currently selected nodes (no nodeId needed)
- "node": Get a single node's full properties (requires nodeId)
- "hierarchy": Get a node tree with children up to a given depth (requires nodeId)
- "variables": List all design variables defined in the document
- "styles": List all local styles in the document`,
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['selection', 'node', 'hierarchy', 'variables', 'styles'],
        description: 'What to read. "selection" for current selection, "node" for a single node, "hierarchy" for a subtree, "variables" for document variables, "styles" for document styles.'
      },
      nodeId: {
        type: 'string',
        description: 'Target node ID. Required for "node" and "hierarchy" modes.'
      },
      depth: {
        type: 'number',
        description: 'Max depth for "hierarchy" mode (default: 5, max: 10).',
        minimum: 1,
        maximum: 10
      }
    },
    required: ['mode']
  },
  executionStrategy: 'parallel',
  errors: {
    'NODE_NOT_FOUND': 'The specified nodeId does not exist.',
    'INVALID_NODE_TYPE': 'The nodeId refers to a non-scene node (e.g. Page or Document).',
    'MISSING_PARAM': 'nodeId is required for "node" and "hierarchy" modes.',
    'INVALID_MODE': 'Mode must be one of: selection, node, hierarchy, variables, styles.'
  }
};
