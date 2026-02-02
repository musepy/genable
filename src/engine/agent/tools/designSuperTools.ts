import { ToolDefinition } from './types';

/**
 * @file designSuperTools.ts
 * @description High-level "Super Tools" for efficient design management.
 * 
 * These tools reduce loops by providing more context per call or 
 * allowing batch operations.
 */

/**
 * Tool: getDeepHierarchy
 * Returns the full DSL tree of a node and its children (deep recursion).
 * Includes absolute positions and all styling.
 */
export const getDeepHierarchyDefinition: ToolDefinition = {
  name: 'getDeepHierarchy',
  category: 'read',
  dependencies: [],
  description: `
[SUPER TOOL] Deeply inspect a node and all its children.
Returns the complete tree structure in DSL format, including IDs for EVERY child.
Use this to understand complex layouts or to find specific layers without multiple calls.
`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: { 
        type: 'string', 
        description: 'Root node ID to start deep inspection from' 
      },
      depthLimit: { 
        type: 'number', 
        description: 'How many levels deep to traverse (default 5, max 10)'
      }
    },
    required: ['nodeId']
  },
  executionStrategy: 'sequential'
};

/**
 * Tool: applyDesignPatch
 * Batch update multiple properties across multiple nodes.
 */
export const applyDesignPatchDefinition: ToolDefinition = {
  name: 'applyDesignPatch',
  category: 'modify',
  dependencies: [],
  description: `
[SUPER TOOL] Apply multiple changes to multiple nodes in a single atomic operation.
Extremely efficient for refining a whole component (e.g., changing colors and spacing at once).
`,
  parameters: {
    type: 'object',
    properties: {
      patches: {
        type: 'array',
        description: 'List of changes to apply',
        items: {
          type: 'object',
          description: 'A single patch targeting a node',
          properties: {
            nodeId: { type: 'string', description: 'Target node ID' },
            layout: { 
              type: 'object', 
              description: 'Optional layout changes (same as setNodeLayout)',
              properties: {
                layoutMode: { type: 'string', enum: ['NONE', 'HORIZONTAL', 'VERTICAL'], description: 'Layout mode' },
                gap: { type: 'number', description: 'Gap value' },
                padding: { 
                  type: 'object', 
                  description: 'Padding object', 
                  properties: { 
                    top: { type: 'number', description: 'Top padding' }, 
                    right: { type: 'number', description: 'Right padding' }, 
                    bottom: { type: 'number', description: 'Bottom padding' }, 
                    left: { type: 'number', description: 'Left padding' } 
                  } 
                },
                sizing: { 
                  type: 'object', 
                  description: 'Sizing object', 
                  properties: { 
                    horizontal: { type: 'string', description: 'Horizontal sizing' }, 
                    vertical: { type: 'string', description: 'Vertical sizing' } 
                  } 
                }
              }
            },
            styles: { 
              type: 'object', 
              description: 'Optional style changes (same as setNodeStyles)',
              properties: {
                fills: { 
                  type: 'array', 
                  items: { type: 'string', description: 'Hex color string' }, 
                  description: 'Fill colors' 
                },
                cornerRadius: { type: 'number', description: 'Corner radius' },
                opacity: { type: 'number', description: 'Opacity' }
              }
            },
            properties: {
              type: 'object',
              description: 'Optional text or general property changes',
              properties: {
                characters: { type: 'string', description: 'Text content' },
                fontSize: { type: 'number', description: 'Font size' }
              }
            }
          },
          required: ['nodeId']
        }
      }
    },
    required: ['patches']
  },
  executionStrategy: 'sequential'
};
