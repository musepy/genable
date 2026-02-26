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
import { COMPACT_PROPS_SCHEMA } from './stateTools';

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
4. TEXT nodes MUST have characters in 'props'. If the text includes formatting with newlines, you MUST output a real physical newline (i.e. \`\\n\` in JSON), NOT a literal escaped string \`\\\\n\`.
5. Root node MUST have explicit width and height in 'props'.
6. ICON nodes MUST have iconName in 'props' (format: "prefix:name", e.g., "lucide:home", "mdi:account").
7. GRADIENT FILLS: In 'props.fills', use hex strings for solid colors, or objects for gradients: {"type":"GRADIENT_LINEAR","stops":[{"position":0,"color":"#C0C0C0"},{"position":1,"color":"#808080"}],"angle":135}
`,
  parameters: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'Real Figma parent ID to attach this component to. If omitted, adds to current page.' },
      nodes: {
        type: 'array',
        description: 'Flat list of all nodes with parent references',
        items: {
          type: 'object',
          description: 'A node: {id, parent, type, props}',
          properties: {
            id: { type: 'string', description: 'Semantic ID (e.g., "email-label", "submit-btn")' },
            parent: { type: 'string', description: 'Parent node ID. For root node, use "root" or empty string.' },
            type: { type: 'string', description: 'FRAME | TEXT | RECTANGLE | ELLIPSE | LINE | ICON. Do NOT use VECTOR — use RECTANGLE for shapes, ELLIPSE for circles, ICON with iconName for icons.' },
            props: {
              type: 'object',
              description: 'All visual and layout properties for the node (width, height, fills, padding, characters, layoutMode, constraints, iconName, etc).',
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
  executionStrategy: 'sequential',
  modes: ['EXECUTION']
};
