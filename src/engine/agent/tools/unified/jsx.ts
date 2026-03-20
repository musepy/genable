/**
 * @file jsx.ts
 * @description Tool definition for the `jsx` command.
 *
 * JSX-like nested markup for batch tree creation.
 * Nesting IS the hierarchy — no path redundancy.
 */

import type { ToolDefinition } from '../types';

export const jsxDefinition: ToolDefinition = {
  name: 'jsx',
  category: 'create',
  executionStrategy: 'sequential',
  display: { displayName: 'JSX', group: 'create' },
  description: `Create design trees with nested JSX-like syntax — batch creation with visual hierarchy.

Usage:
  run({command: "jsx", input: "<frame name='Card' w={400} layout='column' p={24} bg='#FFF' corner={12}>\\n  <text name='Title' size={24} weight='Bold' fill='#111'>Card Title</text>\\n  <text name='Body' size={14} fill='#666' w='fill'>Description text</text>\\n</frame>"})

Elements: frame, text, rect, ellipse, line, icon, image, instance, component, group, section, vector
Attributes: same shorthands as mk (w, h, bg, layout, gap, p, corner, fill, size, weight)
Text: <text size={24}>content here</text>
Instance: <instance ref="Button" variant="Size=Large"/>
Self-closing: <rect w="fill" h={1} fill="#E5E7EB"/>

Use jsx for tree creation (5+ nodes). Use mk for updates and single-node ops.`,
  parameters: {
    type: 'object',
    properties: {
      markup: {
        type: 'string',
        description: 'JSX-like nested markup string',
      },
      parentId: {
        type: 'string',
        description: 'Parent node ID (optional)',
      },
    },
    required: ['markup'],
  },
};
