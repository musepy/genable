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
  executionStrategy: 'sequential',
  mutates: true,
  description: `Create design trees with nested JSX markup — nesting IS the hierarchy.

Examples:
  jsx({markup: "<frame name='Card' layout='col' padding={16} fill='#FFFFFF' w='fill' />"})
  jsx({markup: "<frame name='Section' layout='col' gap={8}><text name='Heading'>Title</text></frame>"})

Elements: frame, text, rect, ellipse, line, icon, image, instance, component, group, section, vector
Attributes: same shorthands (w, h, bg, layout, gap, p, corner, fill, size, weight, stroke, shadow)
Text: <text size={24}>content here</text>
Instance: <instance ref="Button" variant="Size=Large"/>
Self-closing: <line w="fill" stroke="#E5E7EB"/> (divider — use line not rect for dividers/separators)
Arc/Ring: <ellipse w={120} h={120} arc="0 270" fill="#4F46E5"/> (degrees; arc="start end innerRadius?" — innerRadius 0-1 for donut/ring)
Grid: <frame layout="grid" cols={3} rows={2} gap={16} w={720} h={400}>...children fill cells in insertion order...</frame> (always set w AND h explicitly — grid rows divide height equally)

Use jsx for tree creation. Use edit for property updates on existing nodes.`,
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
