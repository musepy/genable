import { ToolDefinition } from './types';
import { TEXT_PROPS_SCHEMA } from '../../../constants/figma-api';
import { COMPACT_PROPS_SCHEMA, FLAT_NODE_SCHEMA } from './stateTools';

/**
 * @file designSuperTools.ts
 * @description High-level "Super Tools" for efficient design management.
 * 
 * These tools reduce loops by providing more context per call or 
 * allowing batch operations.
 */

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
                'applyDesignPatch',
                'patchNode'
              ]
            },
            params: {
              type: 'object',
              description: 'Parameters for the action. Use nodeRef/parentRef for opId references.',
              properties: {
                // Common params mentioned for documentation in schema
                type: { type: 'string', description: 'Node type (e.g. FRAME, TEXT)' },
                parentId: { type: 'string', description: 'Real Figma parent ID' },
                parentRef: { type: 'string', description: 'Virtual ID (opId) of the parent created in this batch' },
                nodeId: { type: 'string', description: 'Real Figma node ID' },
                nodeRef: { type: 'string', description: 'Virtual ID (opId) of the node to modify' },
                // recursive creation support
                children: {
                  type: 'array',
                  description: 'Recursive child operations (createNode only).',
                  items: { 
                    type: 'object', 
                    description: 'Child createNode operation',
                    properties: {
                      opId: { type: 'string', description: 'Unique ID' },
                      action: { type: 'string', description: 'Must be createNode' },
                      params: { 
                        type: 'object', 
                        description: 'Parameters for child creation',
                        properties: { 
                          type: { type: 'string', description: 'Node type (FRAME | TEXT | ICON | etc.)' }, 
                          props: { 
                            type: 'object',
                            description: 'Visual properties',
                            properties: {
                              ...COMPACT_PROPS_SCHEMA
                            }
                          } 
                        } 
                      }
                    }
                  }
                },
                // State-Driven Tool Support
                /* 
                // PAUSED: renderSubtree support in batch
                nodes: {
                  type: 'array',
                  description: 'For renderSubtree: Flat list of nodes.',
                  items: FLAT_NODE_SCHEMA
                },
                */
                props: {
                  type: 'object',
                  description: 'For patchNode: Properties to update.',
                  properties: COMPACT_PROPS_SCHEMA
                },
                stepId: { type: 'string', description: 'Optional step ID pass-through' },
                // -------------------------------------------------------------
                // Explicit array requirements
                // -------------------------------------------------------------
                patches: {
                  type: 'array',
                  description: 'For applyDesignPatch: Array of patch definitions. MUST be used for applyDesignPatch.',
                  items: {
                    type: 'object',
                    description: 'A single patch operation',
                    properties: {
                      nodeId: { type: 'string', description: 'Real Figma node ID' },
                      nodeRef: { type: 'string', description: 'Virtual ID (opId) of the node to modify' },
                      props: {
                        type: 'object',
                        description: 'General node properties (characters, iconName, etc.)',
                        properties: { ...COMPACT_PROPS_SCHEMA }
                      }
                    }
                  }
                },
                // Top-level params for "flat" support
                ...COMPACT_PROPS_SCHEMA,
                iconName: { type: 'string', description: 'For ICON nodes' },
                size: { type: 'number', description: 'For ICON nodes' },
                color: { type: 'string', description: 'For ICON/TEXT nodes' }
              }
            },
            reason: {
              type: 'string',
              description: 'Why this operation is being performed. Helps maintain context and avoid redundant loops.'
            },
            preconditions: {
              type: 'object',
              description: 'Optional validation rules to check before execution.',
              properties: {
                nodeType: { type: 'string', description: 'Expected node type (e.g. FRAME, TEXT)' },
                parentHasAutoLayout: { type: 'boolean', description: 'Requires parent to have auto-layout' }
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
    'PARENT_NOT_FOUND': 'Specified parent node could not be resolved.',
    'NODE_NOT_FOUND': 'Target node does not exist.',
    'APPLY_ERROR': 'Failed to apply operation.',
    'PARTIAL_FAILURE': 'One or more operations failed. Detailed summary included in the error message.'
  }
};

/**
 * Tool: applyDesignPatch
 * Batch update multiple properties across multiple nodes.
 */
export const applyDesignPatchDefinition: ToolDefinition = {
  name: 'applyDesignPatch',
  category: 'modify',
  modes: ['EXECUTION', 'VERIFICATION'],
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
            props: {
              type: 'object',
              description: 'Unified design properties',
              properties: { ...COMPACT_PROPS_SCHEMA }
            }
          },
          required: ['nodeId']
        }
      },
      stepId: {
        type: 'string',
        description: 'Optional step ID from planDesign to mark as completed upon success'
      },
      reason: {
        type: 'string',
        description: 'Why this design patch is being applied.'
      }
    },
    required: ['patches']
  },
  executionStrategy: 'sequential'
};
