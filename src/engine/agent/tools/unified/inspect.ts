import { ToolDefinition } from '../types';

/**
 * Inspect tool — full style details of a node tree.
 * Returns fills, fonts, effects, padding, cornerRadius, etc.
 * Auto-degrades to outline + hint when tree is large.
 */
export const inspectDefinition: ToolDefinition = {
  name: 'inspect',
  category: 'read',
  display: { displayName: 'Inspect', group: 'inspect' },
  description: `Read the full style details of a node tree. Returns fills, fonts, effects, padding, cornerRadius, shadow, and all visual properties.

Auto-degrades to structural skeleton + hint when the tree is large (>2500 chars). When this happens, use \`outline()\` to discover structure, then \`inspect()\` specific children.

Set screenshot=true to also capture a visual screenshot of the node (bundled in the same response).

Output format: XML with abbreviated attributes (w=width, h=height, layout=layoutMode, sizingH/sizingV, alignMain/alignCross, corner, size=fontSize, weight=fontWeight, p=padding, fill/fills, shadow=effects). Text content appears as tag body: <text size="16">Hello</text>.`,
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
