import { ToolDefinition } from '../types';
import { TEXT_PROPS_SCHEMA } from '../../../../constants/figma-api';

/**
 * Unified create tool — replaces generateDesign, renderSubtree, createNode, createIcon, batchOperations(create).
 * Single entry point for all node creation.
 */
export const createNodeDefinition: ToolDefinition = {
  name: 'create_node',
  category: 'create',
  description: `Create one or more nodes in the Figma document. This is the ONLY tool for creating new design elements.

Usage:
- **Single node**: Provide one item in the nodes array.
- **Full component/page**: Provide all nodes in a flat list with parent-child references.
- **Icon**: Use type "ICON" with an iconName prop.

Each node in the flat list uses a temporary "id" for cross-referencing parents within the SAME call.
The first node without a "parent" becomes the root, attached to parentId.

Returns: An idMap mapping your temporary IDs to real Figma node IDs.`,
  parameters: {
    type: 'object',
    properties: {
      parentId: {
        type: 'string',
        description: 'Real Figma node ID to attach the root node to. If omitted, attaches to page selection or root.'
      },
      prompt: {
        type: 'string',
        description: 'Brief description of what you are creating (for tracing/debugging).'
      },
      nodes: {
        type: 'array',
        description: 'Flat list of nodes to create. Use "id" for temporary references and "parent" to reference another node\'s temporary id.',
        items: {
          type: 'object',
          description: 'Node definition object.',
          properties: {
            id: {
              type: 'string',
              description: 'Temporary ID for this node (used by children\'s "parent" field within the same call).'
            },
            parent: {
              type: 'string',
              description: 'Temporary ID of the parent node (must match another node\'s "id" in this array).'
            },
            type: {
              type: 'string',
              enum: ['FRAME', 'TEXT', 'RECTANGLE', 'ELLIPSE', 'LINE', 'ICON'],
              description: 'Node type. Use "ICON" for icon nodes (requires iconName in props).'
            },
            props: {
              type: 'object',
              description: 'All Figma properties: name, characters, width, height, fills, cornerRadius, padding, gap, layoutMode, iconName, fontSize, fontWeight, etc.',
              properties: {
                name: { type: 'string', description: 'Node name (displayed in Figma layers panel)' },
                iconName: { type: 'string', description: 'Icon name in "prefix:name" format (e.g. "lucide:star", "lucide:search", "lucide:shopping-cart", "mdi:home", "tabler:settings"). Supported prefixes: lucide, mdi, heroicons, tabler, f7, hugeicons.' },
                width: { type: 'number', description: 'Fixed width (px)', minimum: 0.01 },
                height: { type: 'number', description: 'Fixed height (px)', minimum: 0.01 },
                fills: { type: 'array', items: { type: 'string', description: 'Hex color' }, description: 'Background colors' },
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
                layoutPositioning: { type: 'string', enum: ['AUTO', 'ABSOLUTE'], description: 'ABSOLUTE ignores parent auto-layout' },
                ...TEXT_PROPS_SCHEMA,
              }
            }
          }
        }
      },
      stepId: {
        type: 'string',
        description: 'Optional step ID for progress tracking.'
      }
    },
    required: ['nodes']
  },
  executionStrategy: 'sequential',
  errors: {
    'INVALID_NODE_TYPE': 'Type must be one of: FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, ICON.',
    'PARENT_NOT_FOUND': 'The specified parentId does not exist.',
    'APPLY_ERROR': 'Failed to create one or more nodes.'
  }
};
