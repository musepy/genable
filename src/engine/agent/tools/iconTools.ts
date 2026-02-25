import { ToolDefinition } from './types';

// ==========================================
// 5. createIcon (Specialized)
// ==========================================

export const createIconDefinition: ToolDefinition = {
  name: 'createIcon',
  category: 'create',
  dependencies: [],
  description: 'Fetch and create an icon from Iconify library.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Optional semantic ID' },
      parentId: { type: 'string', description: 'Parent node ID' },
      iconName: {
        type: 'string',
        description: 'Iconify name (e.g., "lucide:home", "mdi:account")'
      },
      size: { type: 'number', minimum: 1, maximum: 1000, description: 'Size in pixels (default 24)' },
      color: { 
        type: 'string', 
        pattern: '^#[0-9A-Fa-f]{6}$',
        description: 'Icon color hex' 
      },
      props: {
        type: 'object',
        description: '[PREFERRED] Unified design properties (fills, opacity, width, height, etc.)',
        properties: {
          fills: { type: 'array', items: { type: 'string', description: 'Hex color' }, description: 'Icon colors' },
          opacity: { type: 'number', description: 'Layer opacity (0-1)' },
          width: { type: 'number', description: 'Icon width' },
          height: { type: 'number', description: 'Icon height' }
        }
      },
      stepId: {
        type: 'string',
        description: 'Optional step ID from planDesign to mark as completed upon success'
      }
    },
    required: ['iconName']
  },
  executionStrategy: 'sequential',
  modes: ['EXECUTION'],
  errors: {
    'ICON_NOT_FOUND': 'The icon name provided could not be found in the Iconify library.',
    'PARENT_NOT_FOUND': 'Parent node not found.'
  }
};
