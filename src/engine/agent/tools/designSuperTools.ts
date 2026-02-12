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
 * Tool: batchOperations
 * Execute multiple Figma operations in a single ordered call.
 */
export const batchOperationsDefinition: ToolDefinition = {
  name: 'batchOperations',
  category: 'modify',
  dependencies: [],
  description: `
[SUPER TOOL] Execute multiple Figma operations in a single ordered call.
Use opId-based references (nodeRef/parentRef) to chain operations without guessing IDs.
If referencing existing nodes, pass nodeId/parentId directly (do NOT use nodeRef/parentRef).
CROSS-TURN CONTINUITY: Response includes idMap mapping opId -> real nodeId. In subsequent turns, use REAL nodeIds from that map, NOT virtual opIds.
Operations always execute sequentially.

EXAMPLE (Hierarchical Row):
{
  "operations": [
    {
      "opId": "row-container",
      "action": "createNode",
      "params": {
        "type": "FRAME",
        "name": "Data Row",
        "props": { "layoutMode": "HORIZONTAL", "gap": 12, "padding": 16 },
        "children": [
          { "opId": "col-1", "action": "createNode", "params": { "type": "TEXT", "name": "Label", "props": { "characters": "Metric Name" } } },
          { "opId": "col-2", "action": "createNode", "params": { "type": "TEXT", "name": "Value", "props": { "characters": "1,234" } } }
        ]
      }
    }
  ]
}
`,
  parameters: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        description: 'Ordered list of operations to execute',
        items: {
          type: 'object',
          description: 'Single operation definition',
          required: ['opId', 'action', 'params'],
          properties: {
            opId: {
              type: 'string',
              description: 'Unique operation ID (Virtual ID) for intra-batch references. Use this as a handle for nodes created in this batch.'
            },
            action: {
              type: 'string',
              description: 'Operation type to execute',
              enum: [
                'createNode',
                'setNodeLayout',
                'setNodeStyles',
                'updateNodeProperties',
                'createIcon',
                'deleteNode',
                'applyDesignPatch'
              ]
            },
            params: {
              type: 'object',
              description: 'Parameters for the action. Use nodeRef/parentRef for opId references.',
              properties: {
                // Common params mentioned for documentation in schema
                type: { type: 'string', description: 'Node type (e.g. FRAME, TEXT)' },
                name: { type: 'string', description: 'Node name' },
                parentId: { type: 'string', description: 'Real Figma parent ID' },
                parentRef: { type: 'string', description: 'Virtual ID (opId) of the parent created in this batch' },
                nodeId: { type: 'string', description: 'Real Figma node ID' },
                nodeRef: { type: 'string', description: 'Virtual ID (opId) of the node to modify' },
                // recursive creation support
                children: {
                  type: 'array',
                  description: 'Recursive child operations (createNode only). opIds inside children can be referenced globally within the batch.',
                  items: { type: 'object', description: 'Child createNode operation (shares opId, action, params structure)' }
                }
              }
            },
            dependsOn: {
              type: 'array',
              description: 'Optional list of opIds that must succeed before this operation',
              items: { type: 'string', description: 'opId dependency' }
            }
          }
        }
      },
      strategy: {
        type: 'string',
        description: 'Execution strategy (sequential only)',
        enum: ['sequential'],
      },
      onError: {
        type: 'string',
        description: 'Error handling strategy for dependent operations',
        enum: ['skip-dependents', 'continue'],
      },
      stepId: {
        type: 'string',
        description: 'Optional step ID from planDesign to mark as completed upon success'
      }
    },
    required: ['operations']
  },
  executionStrategy: 'sequential',
  errors: {
    'INVALID_ACTION': 'Action must be a supported operation type.',
    'INVALID_OPERATION': 'Operation payload is missing required fields.',
    'MISSING_REF': 'Referenced opId could not be resolved to a nodeId.',
    'DEPENDENCY_SKIP': 'Operation skipped due to failed dependency.',
    'NODE_NOT_FOUND': 'Target node does not exist.',
    'APPLY_ERROR': 'Failed to apply operation.',
    'PARTIAL_FAILURE': 'One or more operations failed.'
  }
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
                },
                layoutPositioning: { type: 'string', enum: ['AUTO', 'ABSOLUTE'], description: 'ABSOLUTE ignores parent auto layout flow' },
                constraints: {
                  type: 'object',
                  description: 'Parent pin/scale behavior',
                  properties: {
                    horizontal: { type: 'string', description: 'MIN | CENTER | MAX | STRETCH | SCALE | LEFT | RIGHT | LEFT_RIGHT' },
                    vertical: { type: 'string', description: 'MIN | CENTER | MAX | STRETCH | SCALE | TOP | BOTTOM | TOP_BOTTOM' }
                  }
                },
                x: { type: 'number', description: 'Explicit x position' },
                y: { type: 'number', description: 'Explicit y position' },
                layoutGrow: { type: 'number', description: 'Auto-layout grow factor' },
                layoutAlign: { type: 'string', description: 'MIN | CENTER | MAX | STRETCH | INHERIT' }
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
              description: '[DEPRECATED] Use props instead.',
              properties: {
                characters: { type: 'string', description: 'Text content' },
                fontSize: { type: 'number', description: 'Font size' }
              }
            },
            props: {
              type: 'object',
              description: '[PREFERRED] Unified design properties',
              properties: {
                fills: { type: 'array', items: { type: 'string', description: 'Hex color' }, description: 'Colors' },
                cornerRadius: { type: 'number', description: 'Corner radius' },
                padding: { type: 'number', description: 'Padding' },
                gap: { type: 'number', description: 'Gap' },
                layoutMode: { type: 'string', enum: ['HORIZONTAL', 'VERTICAL', 'NONE'], description: 'Layout mode' },
                layoutPositioning: { type: 'string', enum: ['AUTO', 'ABSOLUTE'], description: 'ABSOLUTE ignores parent auto layout flow' },
                constraints: {
                  type: 'object',
                  description: 'Parent pin/scale behavior',
                  properties: {
                    horizontal: { type: 'string', description: 'MIN | CENTER | MAX | STRETCH | SCALE | LEFT | RIGHT | LEFT_RIGHT' },
                    vertical: { type: 'string', description: 'MIN | CENTER | MAX | STRETCH | SCALE | TOP | BOTTOM | TOP_BOTTOM' }
                  }
                },
                x: { type: 'number', description: 'Explicit x position' },
                y: { type: 'number', description: 'Explicit y position' },
                characters: { type: 'string', description: 'Text content' },
                fontSize: { type: 'number', description: 'Font size' },
                width: { type: 'number', description: 'Width' },
                height: { type: 'number', description: 'Height' }
              }
            }
          },
          required: ['nodeId']
        }
      },
      stepId: {
        type: 'string',
        description: 'Optional step ID from planDesign to mark as completed upon success'
      }
    },
    required: ['patches']
  },
  executionStrategy: 'sequential'
};
