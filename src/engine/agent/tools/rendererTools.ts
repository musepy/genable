/**
 * @file rendererTools.ts
 * @description Renderer-related tools for the Agent.
 * Only Atomic tools are exposed to ensure precise control over the design process.
 */

import { ToolDefinition } from './types';
import { TEXT_PROPS_SCHEMA } from '../../../constants/figma-api';

// ==========================================
// 0. Planning Tool (ReAct Pattern)
// ==========================================

export const planDesignDefinition: ToolDefinition = {
  name: 'planDesign',
  category: 'plan',
  dependencies: [],
  description: `
[PLANNING] Create a CONCISE execution plan (MAX 8 steps). Each step should group related operations.
Do NOT create one step per node — group sibling nodes, container+children, or related style changes into single steps.

EXAMPLE: For "Create a login form with email, password, and sign-in button":
- Step 1: Create root container "Login Form" with header (title + subtitle)
- Step 2: Create form fields (email input + password input)
- Step 3: Create sign-in button and social login buttons
- Step 4: Apply final layout and styles

ANTI-PATTERN (TOO GRANULAR - DO NOT DO THIS):
- Step 1: Create container → Step 2: Create title → Step 3: Create subtitle → ... (20 steps)
`,
  parameters: {
    type: 'object',
    properties: {
      analysis: {
        type: 'string',
        description: 'Analysis of the user request and design requirements'
      },
      steps: {
        type: 'array',
        description: 'Ordered list of HIGH-LEVEL design milestones (NOT individual tool calls). Each step groups multiple related operations.',
        items: {
          type: 'object',
          description: 'A component-level milestone that requires MULTIPLE tool calls to complete',
          properties: {
            stepNumber: { type: 'number', description: 'Step order (1, 2, 3...)' },
            action: { type: 'string', description: 'High-level description of what to build (e.g., "Build header section with logo, title, and navigation links"). NOT a tool name.' },
            nodes: { type: 'array', items: { type: 'string', description: 'Name of a node/element to create' }, description: 'List of nodes/elements this step will create (e.g., ["Header Frame", "Logo", "Title Text", "Nav Links"])' },
            reasoning: { type: 'string', description: 'Why this step is needed' }
          }
        }
      }
    },
    required: ['analysis', 'steps']
  },
  executionStrategy: 'sequential',
  errors: {}
};

// ==========================================
// 1. node creation (Atomic Entry Point)
// ==========================================

export const createNodeDefinition: ToolDefinition = {
  name: 'createNode',
  category: 'create',
  dependencies: [],
  description: `
[ATOMIC] Create FRAME, TEXT, RECTANGLE, ELLIPSE, or LINE.

⚠️ HIERARCHY RULE:
- For complex structures, use \`batchOperations\` with the \`children\` array to build deep hierarchies in a single call.
- When creating parent-child hierarchy WITHOUT \`batchOperations\`:
  1. MUST wait for parent's createNode to return nodeId BEFORE creating child.
  2. parentId MUST be the exact nodeId from a COMPLETED previous createNode.

Returns: {nodeId: "124:567"} - Use this ID as parentId for child nodes.
`,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['FRAME', 'TEXT', 'RECTANGLE', 'ELLIPSE', 'LINE'],
        description: 'Type of node to create. Invalid values will return INVALID_NODE_TYPE.'
      },
      name: { 
        type: 'string', 
        description: 'Descriptive name for the layer (e.g., "Main Card", "Login Button"). AVOID generic names like "unnamed" or "layer".',
        minimum: 1
      },
      parentId: {
        type: 'string',
        description: `[BLOCKING DEPENDENCY] Parent node ID from a COMPLETED createNode call.
⚠️ MUST wait for parent createNode to return before using this.
If omitted, node is added to current page (root level).
NEVER use a predicted, placeholder, or guessed ID.`
      },
      characters: { 
        type: 'string', 
        description: 'Initial text content (Only used if type=TEXT). Defaults to "Text".' 
      },
      layout: {
        type: 'object',
        description: '[INLINE OPTIMIZATION] Configure Auto Layout (padding, gap, sizing) during creation to save iterations. Same schema as setNodeLayout.',
        properties: {
          layoutMode: { type: 'string', enum: ['NONE', 'HORIZONTAL', 'VERTICAL'], description: 'Auto layout direction' },
          sizing: { 
            type: 'object', 
            description: 'Sizing rules',
            properties: { 
              horizontal: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Horizontal sizing' }, 
              vertical: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Vertical sizing' } 
            } 
          },
          padding: { 
            type: 'object', 
            description: 'Padding values',
            properties: { 
              horizontal: { type: 'number', description: 'Horizontal padding' }, 
              vertical: { type: 'number', description: 'Vertical padding' }, 
              top: { type: 'number', description: 'Top padding' }, 
              right: { type: 'number', description: 'Right padding' }, 
              bottom: { type: 'number', description: 'Bottom padding' }, 
              left: { type: 'number', description: 'Left padding' } 
            } 
          },
          gap: { type: 'number', description: 'Gap between children' },
          layoutPositioning: { type: 'string', enum: ['AUTO', 'ABSOLUTE'], description: 'For children in auto-layout parent: ABSOLUTE ignores auto-layout flow.' },
          constraints: {
            type: 'object',
            description: 'Pin/scale behavior relative to parent (for non-auto-layout or ABSOLUTE children).',
            properties: {
              horizontal: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'LEFT', 'RIGHT', 'LEFT_RIGHT'], description: 'Horizontal constraint' },
              vertical: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'TOP', 'BOTTOM', 'TOP_BOTTOM'], description: 'Vertical constraint' }
            }
          },
          x: { type: 'number', description: 'Explicit x position. Works on non-auto-layout parent, or ABSOLUTE child in auto-layout parent.' },
          y: { type: 'number', description: 'Explicit y position. Works on non-auto-layout parent, or ABSOLUTE child in auto-layout parent.' },
          width: { type: 'number', description: 'Explicit width', minimum: 0.01 },
          height: { type: 'number', description: 'Explicit height', minimum: 0.01 }
        }
      },
      styles: {
        type: 'object',
        description: '[DEPRECATED] Use props instead.',
        properties: {
          fills: { type: 'array', items: { type: 'string', description: 'Hex or variable' }, description: 'Background/Text colors' },
          strokes: { type: 'array', items: { type: 'string', description: 'Hex or variable' }, description: 'Stroke colors' },
          strokeWeight: { type: 'number', description: 'Stroke thickness' },
          cornerRadius: { type: 'number', description: 'Corner radius' },
          opacity: { type: 'number', description: 'Layer opacity (0-1)' }
        }
      },
      props: {
        type: 'object',
        description: '[PREFERRED] Unified design properties (fills, cornerRadius, padding, gap, etc.)',
        properties: {
          fills: { type: 'array', items: { type: 'string', description: 'Hex color' }, description: 'Background colors' },
          cornerRadius: { type: 'number', description: 'Corner radius (px)' },
          padding: { type: 'number', description: 'Uniform padding (px)' },
          gap: { type: 'number', description: 'Gap between children (px)' },
          layoutMode: { type: 'string', enum: ['HORIZONTAL', 'VERTICAL', 'NONE'], description: 'Auto Layout mode' },
          primaryAxisAlignItems: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'], description: 'Primary axis alignment' },
          counterAxisAlignItems: { type: 'string', enum: ['MIN', 'CENTER', 'MAX'], description: 'Counter axis alignment' },
          layoutSizingHorizontal: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Horizontal sizing' },
          layoutSizingVertical: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Vertical sizing' },
          layoutPositioning: { type: 'string', enum: ['AUTO', 'ABSOLUTE'], description: 'ABSOLUTE = ignore parent auto layout flow (if parent is auto-layout)' },
          constraints: {
            type: 'object',
            description: 'Pin/scale behavior relative to parent',
            properties: {
              horizontal: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'LEFT', 'RIGHT', 'LEFT_RIGHT'], description: 'Horizontal constraint' },
              vertical: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'TOP', 'BOTTOM', 'TOP_BOTTOM'], description: 'Vertical constraint' }
            }
          },
          x: { type: 'number', description: 'Explicit x position' },
          y: { type: 'number', description: 'Explicit y position' },
          width: { type: 'number', description: 'Fixed width', minimum: 0.01 },
          height: { type: 'number', description: 'Fixed height', minimum: 0.01 },
          ...TEXT_PROPS_SCHEMA,
        }
      },
      stepId: {
        type: 'string',
        description: 'Optional step ID from planDesign to mark as completed upon success'
      }
    },
    required: ['type', 'name']
  },
  executionStrategy: 'sequential',
  errors: {
    'INVALID_NODE_TYPE': 'Type must be one of: FRAME, TEXT, RECTANGLE, ELLIPSE, LINE',
    'PARENT_NOT_FOUND': 'The specified parentId does not exist. Create the parent first.'
  }
};

// ==========================================
// 2. setNodeLayout
// ==========================================

export const setNodeLayoutDefinition: ToolDefinition = {
  name: 'setNodeLayout',
  category: 'modify',
  dependencies: ['createNode'],
  description: `
Configure Auto Layout for a Frame.
Set Padding, Gap, and Sizing (FIXED/HUG/FILL).
Use nodeId from createNode response.

CRITICAL CONSTRAINTS:
- HUG sizing requires Auto Layout context. Valid when:
  1. The node itself has layoutMode=VERTICAL/HORIZONTAL (becomes an Auto Layout container), OR
  2. The parent node has Auto Layout enabled
- FILL sizing requires the parent to have Auto Layout
- FIXED sizing works in all contexts

BEST PRACTICE: When creating a container that should HUG its content,
set layoutMode to VERTICAL/HORIZONTAL in the SAME setNodeLayout call.
`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Target node ID (from createNode response)' },
      layoutMode: {
        type: 'string',
        enum: ['NONE', 'HORIZONTAL', 'VERTICAL'],
        description: 'Auto layout direction. Set to VERTICAL/HORIZONTAL to enable Auto Layout. Invalid values return INVALID_LAYOUT_MODE.'
      },
      sizing: {
        type: 'object',
        properties: {
          horizontal: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Horizontal sizing. HUG requires Auto Layout context (see constraints above).' },
          vertical: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Vertical sizing. HUG requires Auto Layout context (see constraints above).' }
        },
        description: 'Layout sizing rules'
      },
      padding: {
        type: 'object',
        properties: {
          horizontal: { type: 'number', minimum: 0, description: 'Horizontal padding (px)' },
          vertical: { type: 'number', minimum: 0, description: 'Vertical padding (px)' },
          top: { type: 'number', minimum: 0, description: 'Top padding (px)' },
          right: { type: 'number', minimum: 0, description: 'Right padding (px)' },
          bottom: { type: 'number', minimum: 0, description: 'Bottom padding (px)' },
          left: { type: 'number', minimum: 0, description: 'Left padding (px)' }
        },
        description: 'Padding values in pixels'
      },
      gap: { type: 'number', minimum: 0, description: 'Gap between children (Auto Layout only)' },
      layoutPositioning: {
        type: 'string',
        enum: ['AUTO', 'ABSOLUTE'],
        description: 'When parent is Auto Layout: ABSOLUTE lets this child ignore flow and use x/y.'
      },
      constraints: {
        type: 'object',
        description: 'Pin/scale behavior relative to parent.',
        properties: {
          horizontal: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'LEFT', 'RIGHT', 'LEFT_RIGHT'], description: 'Horizontal constraint mode' },
          vertical: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'TOP', 'BOTTOM', 'TOP_BOTTOM'], description: 'Vertical constraint mode' }
        }
      },
      x: { type: 'number', description: 'Explicit x position. Valid for non-auto-layout parent or ABSOLUTE child in auto-layout parent.' },
      y: { type: 'number', description: 'Explicit y position. Valid for non-auto-layout parent or ABSOLUTE child in auto-layout parent.' },
      layoutGrow: { type: 'number', description: 'Auto-layout grow value for flow children (typically 0 or 1).' },
      layoutAlign: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'INHERIT'], description: 'Auto-layout cross-axis alignment for flow children.' },
      width: { type: 'number', minimum: 0.01, description: 'Explicit width (only for FIXED sizing)' },
      height: { type: 'number', minimum: 0.01, description: 'Explicit height (only for FIXED sizing)' },
      stepId: {
        type: 'string',
        description: 'Optional step ID from planDesign to mark as completed upon success'
      }
    },
    required: ['nodeId']
  },
  executionStrategy: 'sequential',
  errors: {
    'INVALID_LAYOUT_MODE': 'layoutMode must be one of: NONE, HORIZONTAL, VERTICAL',
    'INVALID_SIZING': 'HUG sizing requires Auto Layout context. Either set layoutMode to VERTICAL/HORIZONTAL, or ensure parent has Auto Layout.',
    'NODE_NOT_FOUND': 'Node not found. Use nodeId from createNode response.'
  }
};

// ==========================================
// 3. setNodeStyles
// ==========================================

export const setNodeStylesDefinition: ToolDefinition = {
  name: 'setNodeStyles',
  category: 'modify',
  dependencies: ['createNode'],
  description: `
Update visual styling (Fills, Strokes, Effects).
Use nodeId from createNode response.
`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Target node ID (from createNode response)' },
      fills: {
        type: 'array',
        items: { 
          type: 'string', 
          pattern: '^#[0-9A-Fa-f]{6}$', 
          description: 'Color hex code (e.g., "#FF0000") or variable name' 
        },
        maxItems: 10,
        description: 'Background colors / Text colors'
      },
      strokes: {
        type: 'array',
        items: { 
          type: 'string', 
          pattern: '^#[0-9A-Fa-f]{6}$', 
          description: 'Color hex code' 
        },
        maxItems: 5,
        description: 'Stroke colors'
      },
      strokeWeight: { type: 'number', minimum: 0, maximum: 100, description: 'Stroke thickness' },
      cornerRadius: { type: 'number', minimum: 0, maximum: 1000, description: 'Radius in pixels' },
      opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Layer opacity (0-1)' },
      stepId: {
        type: 'string',
        description: 'Optional step ID from planDesign to mark as completed upon success'
      }
    },
    required: ['nodeId']
  },
  executionStrategy: 'sequential',
  errors: {
    'INVALID_COLOR_FORMAT': 'Colors must be in valid Hex format (e.g., #FFFFFF).',
    'NODE_NOT_FOUND': 'Node not found. Use nodeId from createNode response.'
  }
};

// ==========================================
// 4. updateNodeProperties (General + Text)
// ==========================================

export const updateNodePropertiesDefinition: ToolDefinition = {
  name: 'updateNodeProperties',
  category: 'modify',
  dependencies: ['createNode'],
  description: `
Update TEXT (fontSize, fontFamily, fontWeight, align) or general properties (visible, name).
Use nodeId from createNode response.
`,
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'Target node ID (from createNode response)'
      },
      properties: {
        type: 'object',
        description: 'Key-value pairs to update.',
        properties: {
          ...TEXT_PROPS_SCHEMA,
        }
      },
      stepId: {
        type: 'string',
        description: 'Optional step ID from planDesign to mark as completed upon success'
      }
    },
    required: ['nodeId', 'properties']
  },
  executionStrategy: 'sequential',
  errors: {
    'NODE_NOT_FOUND': 'Node not found. Use nodeId from createNode response.',
    'FONT_NOT_LOADED': 'Font not available. Please use a default font or ensure it is loaded.'
  }
};

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
      layout: {
        type: 'object',
        description: '[INLINE OPTIMIZATION] Configure Auto Layout (padding, gap, sizing) during creation. Same schema as setNodeLayout.',
        properties: {
          sizing: { 
            type: 'object', 
            description: 'Sizing rules',
            properties: { 
              horizontal: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Horizontal sizing' }, 
              vertical: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'Vertical sizing' } 
            } 
          }
        }
      },
      styles: {
        type: 'object',
        description: '[DEPRECATED] Use props instead.',
        properties: {
          opacity: { type: 'number', description: 'Layer opacity (0-1)' }
        }
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
  errors: {
    'ICON_NOT_FOUND': 'The icon name provided could not be found in the Iconify library.',
    'PARENT_NOT_FOUND': 'Parent node not found.'
  }
};

// ==========================================
// 6. deleteNode
// ==========================================

export const deleteNodeDefinition: ToolDefinition = {
  name: 'deleteNode',
  category: 'modify',
  dependencies: [],
  description: 'Remove a node from the document.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'ID of node to delete' }
    },
    required: ['nodeId']
  },
  executionStrategy: 'sequential'
};
