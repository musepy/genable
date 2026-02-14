/**
 * @file generateDesignTool.ts
 * @description One-shot design generation tool.
 *
 * Instead of creating nodes one-by-one across 20+ agent iterations,
 * this tool lets the LLM output a flat list of all nodes in a single call.
 * The handler reconstructs the tree and renders it in one pass.
 *
 * Token cost: O(n) instead of O(n²).
 */

import { ToolDefinition } from './types';
import { TEXT_PROPS_SCHEMA } from '../../../constants/figma-api';

export const generateDesignDefinition: ToolDefinition = {
  name: 'generateDesign',
  category: 'create',
  dependencies: ['planDesign'],
  description: `
[ONE-SHOT] Generate a complete UI component or layout in a single call.
Output ALL nodes as a flat list with parent references. The system reconstructs and renders the full tree.

This is the PREFERRED tool for creating new designs. Use createNode only for single-node edits.
You can freely specify fontFamily for TEXT nodes (any Google Font, e.g. "Roboto", "Poppins", "Noto Sans SC").

## Output Format Rules
1. First node MUST have parent: null (root).
2. Every other node references its parent by id.
3. ALL styling (fills, cornerRadius, gap, padding, fontSize, etc.) MUST go inside 'props'.
4. TEXT nodes MUST have characters in 'props'.
5. Root node MUST have explicit width and height in 'props'.
6. ICON nodes MUST have iconName in 'props' (format: "prefix:name", e.g., "lucide:home", "mdi:account").
`,
  parameters: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: 'Flat list of all nodes with parent references',
        items: {
          type: 'object',
          description: 'A node: {id, parent, type, props}',
          properties: {
            id: { type: 'string', description: 'Semantic ID (e.g., "email-label", "submit-btn")' },
            parent: { type: 'string', description: 'Parent node ID. For root node, use "root" or empty string.' },
            type: { type: 'string', description: 'FRAME | TEXT | RECTANGLE | ELLIPSE | LINE | ICON' },
            props: {
              type: 'object',
              description: 'All visual and layout properties for the node',
              properties: {
                name: { type: 'string', description: 'Layer name' },
                iconName: { type: 'string', description: 'Iconify icon name for ICON nodes (e.g., "lucide:home", "mdi:account")' },
                layoutMode: { type: 'string', description: 'HORIZONTAL | VERTICAL | NONE' },
                primaryAxisAlignItems: { type: 'string', description: 'MIN | CENTER | MAX | SPACE_BETWEEN' },
                counterAxisAlignItems: { type: 'string', description: 'MIN | CENTER | MAX' },
                gap: { type: 'number', description: 'Spacing between children' },
                padding: { type: 'number', description: 'Uniform padding (or use paddingTop/Right/Bottom/Left)' },
                paddingTop: { type: 'number', description: 'Top padding' },
                paddingRight: { type: 'number', description: 'Right padding' },
                paddingBottom: { type: 'number', description: 'Bottom padding' },
                paddingLeft: { type: 'number', description: 'Left padding' },
                layoutPositioning: { type: 'string', description: 'AUTO | ABSOLUTE (for child in auto-layout parent)' },
                constraints: {
                  type: 'object',
                  description: 'Pin/scale behavior relative to parent',
                  properties: {
                    horizontal: { type: 'string', description: 'MIN | CENTER | MAX | STRETCH | SCALE | LEFT | RIGHT | LEFT_RIGHT' },
                    vertical: { type: 'string', description: 'MIN | CENTER | MAX | STRETCH | SCALE | TOP | BOTTOM | TOP_BOTTOM' }
                  }
                },
                x: { type: 'number', description: 'Explicit x position. Valid for non-auto-layout parent, or ABSOLUTE child in auto-layout parent.' },
                y: { type: 'number', description: 'Explicit y position. Valid for non-auto-layout parent, or ABSOLUTE child in auto-layout parent.' },
                layoutGrow: { type: 'number', description: 'Auto-layout grow factor (usually 0 or 1)' },
                layoutAlign: { type: 'string', description: 'MIN | CENTER | MAX | STRETCH | INHERIT' },
                fills: { type: 'array', items: { type: 'string', description: 'Hex color' }, description: 'Background colors, e.g. ["#FFFFFF"]' },
                strokes: { type: 'array', items: { type: 'string', description: 'Hex color' }, description: 'Border colors' },
                strokeWeight: { type: 'number', description: 'Border width' },
                cornerRadius: { type: 'number', description: 'Border radius in px' },
                width: { type: 'number', description: 'Width in px (for FIXED sizing)' },
                height: { type: 'number', description: 'Height in px (for FIXED sizing)' },
                layoutSizingHorizontal: { type: 'string', description: 'FIXED | HUG | FILL' },
                layoutSizingVertical: { type: 'string', description: 'FIXED | HUG | FILL' },
                ...TEXT_PROPS_SCHEMA,
                opacity: { type: 'number', description: '0.0 to 1.0' },
                effects: {
                  type: 'array',
                  items: {
                    type: 'object',
                    description: 'Effect: {type, color, offset, blur, spread}',
                    properties: {
                      effectType: { type: 'string', description: 'DROP_SHADOW | INNER_SHADOW | LAYER_BLUR | BACKGROUND_BLUR' },
                      color: { type: 'string', description: 'Hex+alpha e.g. "#0000001A" (10% black), "#4F46E533" (20% indigo)' },
                      offset: { type: 'object', description: '{x, y} in px', properties: { x: { type: 'number', description: 'Horizontal offset' }, y: { type: 'number', description: 'Vertical offset' } } },
                      blur: { type: 'number', description: 'Blur radius (4=subtle, 16=medium, 32=dramatic)' },
                      spread: { type: 'number', description: 'Spread radius (usually 0)' }
                    }
                  },
                  description: 'Visual effects. Example: [{"type":"DROP_SHADOW","color":"#0000001A","offset":{"x":0,"y":4},"blur":16,"spread":0}]'
                }
              }
            }
          },
          required: ['id', 'type', 'props']
        }
      },
      stepId: {
        type: 'string',
        description: 'Plan step ID. MANDATORY if this call executes a task from your plan. Ensures progress is automatically marked as completed.'
      }
    },
    required: ['nodes']
  },
  executionStrategy: 'sequential'
};
