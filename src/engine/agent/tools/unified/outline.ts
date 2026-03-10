import { ToolDefinition } from '../types';

/**
 * Outline tool — structural skeleton of a node tree.
 * Returns id, name, type, dimensions, layout mode, position. ~100-300 tokens.
 * Use for navigation, discovering children, planning edits.
 */
export const outlineDefinition: ToolDefinition = {
  name: 'outline',
  category: 'read',
  display: { displayName: 'Outline', group: 'inspect' },
  description: `Read the structural skeleton of a node tree. Returns id, name, type, dimensions (w/h), layout mode, and position (x/y). ~100-300 tokens.

Use for navigation, discovering children, planning edits. Much cheaper than inspect.
Text nodes show content inline if short, otherwise chars="N".

Returns \`suggestedReads\` — IDs of complex children worth inspecting in detail.

Progressive reading pattern:
1. \`context()\` — see page overview, find root node IDs
2. \`outline(rootId)\` — discover structure, get child IDs + suggestedReads
3. \`inspect(childId)\` — get full details for specific subtrees`,
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
    },
    required: ['nodeId']
  },
  executionStrategy: 'parallel',
  errors: {
    'NODE_NOT_FOUND': 'The specified nodeId does not exist.',
    'INVALID_NODE_TYPE': 'The nodeId refers to a non-scene node (e.g. Page or Document).',
  }
};
