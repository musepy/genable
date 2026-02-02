/**
 * @file rendererTools.ts
 * @description Renderer-related tools for the Agent.
 * Only Atomic tools are exposed to ensure precise control over the design process.
 */

import { ToolDefinition } from './types';

// ==========================================
// 0. Planning Tool (ReAct Pattern)
// ==========================================

export const planDesignDefinition: ToolDefinition = {
  name: 'planDesign',
  category: 'plan',
  dependencies: [],
  description: `
[PLANNING] BEFORE creating any nodes, analyze the task and create a detailed execution plan.
This tool helps ensure proper structure, dependencies, and content are planned before execution.

Use this tool to:
1. Analyze user requirements and break down into steps
2. Identify dependencies between nodes (e.g., parent must exist before child)
3. Plan content for each TEXT node upfront
4. Determine layout strategy (Auto Layout requirements)
5. Verify naming conventions

EXAMPLE: For "Create a login form with title and button":
- Step 1: Create container FRAME "Login Form"
- Step 2: Create TEXT "Title" with content "Welcome Back"
- Step 3: Create TEXT "Email Label" with content "Email"
- Step 4: Create container FRAME "Email Input Group"
- Step 5: Create TEXT "Button" with content "Sign In"
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
        description: 'Ordered list of planned actions. Each step must include: stepNumber (number), action (string), parameters (object), reasoning (string)',
        items: {
          type: 'object',
          description: 'A single planned step with tool call details',
          properties: {
            stepNumber: { type: 'number', description: 'Step order (1, 2, 3...)' },
            action: { type: 'string', description: 'Tool to call (createNode, setNodeLayout, etc.)' },
            parameters: { type: 'object', description: 'Parameters for the tool call' },
            dependencies: { 
              type: 'array', 
              description: 'Step numbers that must complete before this step',
              items: { type: 'number', description: 'Step number dependency' }
            },
            reasoning: { type: 'string', description: 'Why this step is needed and what it accomplishes' }
          }
        }
      },
      contentPlan: {
        type: 'object',
        description: 'Plan for text content in each TEXT node',
        properties: {
          textNodes: {
            type: 'array',
            description: 'List of text nodes with planned content',
            items: {
              type: 'object',
              description: 'Text node content plan',
              properties: {
                name: { type: 'string', description: 'Node name' },
                characters: { type: 'string', description: 'Actual text content to display' },
                purpose: { type: 'string', description: 'What this text communicates' }
              }
            }
          }
        }
      },
      layoutStrategy: {
        type: 'object',
        description: 'Layout and sizing strategy',
        properties: {
          rootLayout: { type: 'string', description: 'Layout mode for root container (VERTICAL/HORIZONTAL/NONE)' },
          sizingRules: { type: 'string', description: 'Sizing strategy (FIXED/HUG/FILL) for key nodes' },
          autoLayoutChain: { type: 'string', description: 'Description of Auto Layout parent-child relationships' }
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
PRIMARY way to create layers. Defaults to 100x100.
Returns: {nodeId: "124:567"} - Use this exact ID for subsequent operations.
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
        description: 'ID of the parent node (from createNode response). If omitted, adds to current page.' 
      },
      characters: { 
        type: 'string', 
        description: 'Initial text content (Only used if type=TEXT). Defaults to "Text".' 
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
      strokeWeight: { type: 'number', minimum: 0, description: 'Stroke thickness' },
      cornerRadius: { type: 'number', minimum: 0, description: 'Radius in pixels' },
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
          // Text specific hints for the LLM
          fontSize: { type: 'number', minimum: 1, description: 'Font size' },
          fontWeight: { type: 'string', description: 'Check available weights for font' },
          fontFamily: { type: 'string', description: 'Font family' },
          textAlignHorizontal: { type: 'string', enum: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'], description: 'Text alignment' },
          textAlignVertical: { type: 'string', enum: ['TOP', 'CENTER', 'BOTTOM'], description: 'Vertical alignment' },
          characters: { type: 'string', description: 'Update text content' }
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
      size: { type: 'number', minimum: 1, description: 'Size in pixels (default 24)' },
      color: { 
        type: 'string', 
        pattern: '^#[0-9A-Fa-f]{6}$',
        description: 'Icon color hex' 
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
