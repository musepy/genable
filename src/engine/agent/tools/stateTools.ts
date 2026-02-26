/**
 * @file stateTools.ts
 * @description State-driven tools for high-level design operations.
 *
 * IMPORTANT: Tool schemas are intentionally compact to stay within Gemini API
 * schema size limits. Runtime accepts ALL Figma props — the schema only guides
 * LLM output. Full property documentation is in the tool description.
 */

import { ToolDefinition } from './types';

/**
 * Compact props schema — only the most commonly used properties.
 * Runtime accepts all Figma properties regardless of schema definition.
 * This keeps the serialized tool declaration under Gemini's limits.
 */
export const COMPACT_PROPS_SCHEMA = {
  name: { type: 'string' as const, description: 'Layer name' },
  layoutMode: { type: 'string' as const, description: 'HORIZONTAL | VERTICAL | NONE' },
  width: { type: 'number' as const, description: 'Width in px' },
  height: { type: 'number' as const, description: 'Height in px' },
  characters: { type: 'string' as const, description: 'Text content (for TEXT nodes)' },
  fills: { type: 'array' as const, items: { type: 'string' as const, description: 'Hex color string' }, description: 'Background colors (e.g. ["#FFFFFF"])' },
  // Let the LLM output any other Figma properties dynamically without strict JSON Schema validation throwing errors
  // properties like gap, padding, fontSize, cornerRadius, etc. works automatically because the actual Node SDK consumes them blindly.
} as const;

export const FLAT_NODE_SCHEMA = {
  type: 'object' as const,
  description: 'Node definition with id, type, props',
  properties: {
    id: { type: 'string' as const, description: 'Temporary ID (e.g., "root", "btn-text")' },
    parent: { type: 'string' as const, description: 'Parent ID within this list. For root node, use "root" or empty string.' },
    type: { type: 'string' as const, description: 'FRAME | TEXT | RECTANGLE | ELLIPSE | LINE | ICON' },
    props: {
      type: 'object' as const,
      description: 'All Figma properties (fills, gap, padding, etc.)',
      properties: COMPACT_PROPS_SCHEMA
    }
  },
  // required: ['id', 'type', 'props'] -- RELAXED for first-turn 400 fix
};

export const renderSubtreeDefinition: ToolDefinition = {
  name: 'renderSubtree',
  category: 'create',
  modes: ['RECOVERY'],
  dependencies: [],
  description: `[STATE-DRIVEN] Render a complete UI subtree in one call. Use this for creating components or complex groups.
  
  Must provide a FLAT LIST of nodes (Adjacency List).
  - First node is the subtree root (parent: null).
  - All other nodes must reference a parentId from within this list.
  - All styling goes into 'props'.`,
  parameters: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'Real Figma parent ID to attach this subtree to. If omitted, adds to current page.' },
      nodes: {
        type: 'array',
        description: 'Flat list of nodes to create. First node is root.',
        items: FLAT_NODE_SCHEMA
      },
      stepId: { type: 'string', description: 'Optional step ID from planDesign' }
    },
    required: ['nodes']
  },
  executionStrategy: 'sequential'
};

export const patchNodeDefinition: ToolDefinition = {
  name: 'patchNode',
  category: 'modify',
  modes: ['EXECUTION', 'VERIFICATION'],
  dependencies: [],
  description: `[STATE-DRIVEN] Update a single node's PROPERTIES (state).
  
  Does NOT handle structure changes (add/remove children).
  Simply merges the provided props into the target node.`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'ID of the node to update' },
      props: {
        type: 'object',
        description: 'Properties to merge (fills, cornerRadius, layoutMode, etc.)',
        properties: COMPACT_PROPS_SCHEMA
      },
      stepId: { type: 'string', description: 'Optional step ID from planDesign' }
    },
    required: ['nodeId', 'props']
  },
  executionStrategy: 'sequential'
};
