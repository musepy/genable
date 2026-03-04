import { ToolDefinition } from '../types';

/**
 * Unified read tool — single entry point for querying the Figma document.
 * Returns compact XML format for token efficiency.
 */
export const readNodeDefinition: ToolDefinition = {
  name: 'read',
  category: 'read',
  display: { displayName: 'Read', group: 'inspect' },
  description: `Read a node tree from the Figma document. Returns compact XML representation.

Returns the node and its children up to the specified depth as XML.

Output format: XML with abbreviated attributes (w=width, h=height, layout=layoutMode, sizingH/sizingV, alignMain/alignCross, corner, size=fontSize, weight=fontWeight, p=padding, fill/fills, shadow=effects). Text content appears as tag body: <text size="16">Hello</text>.

Set screenshot=true to also capture a visual screenshot of the node (bundled in the same response).`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'Target node ID. Required.'
      },
      depth: {
        type: 'number',
        description: 'Max depth for hierarchy traversal (default: 5, max: 10).',
        minimum: 1,
        maximum: 10
      },
      screenshot: {
        type: 'boolean',
        description: 'If true, also capture a screenshot of the node. Eliminates the need for a separate screenshot call.'
      }
    },
    required: ['nodeId']
  },
  executionStrategy: 'parallel',
  errors: {
    'NODE_NOT_FOUND': 'The specified nodeId does not exist.',
    'INVALID_NODE_TYPE': 'The nodeId refers to a non-scene node (e.g. Page or Document).',
  }
};
