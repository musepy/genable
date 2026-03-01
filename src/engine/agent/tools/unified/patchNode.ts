import { ToolDefinition } from '../types';
import { TEXT_PROPS_SCHEMA } from '../../../../constants/figma-api';

/**
 * Unified patch tool — replaces patchNode, applyDesignPatch, batchOperations(update).
 * Single entry point for modifying existing nodes.
 */
export const patchNodeDefinition: ToolDefinition = {
  name: 'patch_node',
  category: 'modify',
  dependencies: ['read_node'],
  description: `Update properties of one or more existing nodes. This is the ONLY tool for modifying existing elements.

Usage:
- **Single node**: Provide one patch in the patches array.
- **Multiple nodes**: Provide multiple patches to update several nodes at once.

IMPORTANT: Always use read_node first to get real nodeIds before patching.
Only include the properties you want to CHANGE — unspecified properties remain unchanged.`,
  parameters: {
    type: 'object',
    properties: {
      patches: {
        type: 'array',
        description: 'Array of patches. Each patch targets one node by nodeId.',
        items: {
          type: 'object',
          description: 'Patch for a single node.',
          properties: {
            nodeId: {
              type: 'string',
              description: 'Real Figma node ID to update (from read_node or previous create_node response).'
            },
            props: {
              type: 'object',
              description: 'Properties to update. Only include changed properties.',
              properties: {
                name: { type: 'string', description: 'Node name' },
                width: { type: 'number', description: 'Width (px)', minimum: 0.01 },
                height: { type: 'number', description: 'Height (px)', minimum: 0.01 },
                fills: { type: 'array', items: { type: 'string', description: 'Hex color' }, description: 'Background fills' },
                cornerRadius: { type: 'number', description: 'Corner radius (px)' },
                layoutMode: { type: 'string', enum: ['NONE', 'HORIZONTAL', 'VERTICAL'], description: 'Auto layout direction' },
                layoutSizingHorizontal: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Horizontal sizing' },
                layoutSizingVertical: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Vertical sizing' },
                padding: { type: 'number', description: 'Uniform padding (px)' },
                paddingTop: { type: 'number', description: 'Top padding' },
                paddingRight: { type: 'number', description: 'Right padding' },
                paddingBottom: { type: 'number', description: 'Bottom padding' },
                paddingLeft: { type: 'number', description: 'Left padding' },
                itemSpacing: { type: 'number', description: 'Gap between children' },
                opacity: { type: 'number', description: 'Layer opacity (0-1)' },
                strokeWeight: { type: 'number', description: 'Stroke thickness' },
                layoutPositioning: { type: 'string', enum: ['AUTO', 'ABSOLUTE'], description: 'Layout positioning' },
                ...TEXT_PROPS_SCHEMA,
              }
            }
          },
          required: ['nodeId', 'props']
        }
      },
      stepId: {
        type: 'string',
        description: 'Optional step ID for progress tracking.'
      }
    },
    required: ['patches']
  },
  executionStrategy: 'sequential',
  errors: {
    'NODE_NOT_FOUND': 'One or more nodeIds do not exist. Use read_node to get valid IDs.',
    'APPLY_ERROR': 'Failed to update one or more nodes.',
    'PRECONDITION_FAILED': 'Layout constraint violation detected (e.g., HUG without auto-layout).'
  }
};
