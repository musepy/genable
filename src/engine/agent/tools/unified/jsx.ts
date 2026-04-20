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
  // createdIds is runtime-only (inspection tracker); LLM doesn't need 69 IDs.
  presentForLLM: (data) => {
    const { createdIds: _omit, ...rest } = data;
    return rest;
  },
  description: `Create design trees with nested JSX markup. One jsx call builds a complete subtree atomically — nesting is the hierarchy. Keep a single logical unit inside one call; the returned root's children are already built, not stubs to be filled in later.

Examples:
  jsx({markup: "<frame name='Card' layout='column' padding={16} fill='#FFFFFF' w='fill' />"})
  jsx({markup: "<frame name='Row' layout='row' gap={8} padding={12} w='fill'><icon name='lucide:settings' size={20} /><text name='Label' w='fill'>Account</text><icon name='lucide:chevron-right' size={16} /></frame>"})

Elements: frame, text, rect, ellipse, line, icon, image, instance, component, group, section, vector
Attributes: w, h, bg, layout, gap, p, corner, fill, size, weight, stroke, shadow
Text: <text size={24}>content here</text>
Instance: <instance ref="Button" variant="Size=Large"/>
Self-closing: <line w="fill" stroke="#E5E7EB"/> (use line for dividers/separators; rect is for decoration without children)
Arc/Ring: <ellipse w={120} h={120} arc="0 270" fill="#4F46E5"/> (arc="start end innerRadius?" — innerRadius 0-1 makes a donut/ring)
Grid layout: load knowledge("help:grid-layout") for tracks, gaps, and when row/column is a better fit

Swap an existing subtree: jsx({replaceId: "<id>", markup: "..."}) replaces the old node at the same parent and sibling index atomically, preserving position in one call. Markup must have a single root. Use jsx for tree creation; edit for property updates on known nodes.`,
  parameters: {
    type: 'object',
    properties: {
      markup: {
        type: 'string',
        description: 'JSX-like nested markup string',
      },
      parentId: {
        type: 'string',
        description: 'Parent node ID to append into (optional). Mutually exclusive with replaceId.',
      },
      replaceId: {
        type: 'string',
        description: 'Replace this existing node in-place (keeps parent + sibling index). Old node is deleted on success. Markup must be single-root. Mutually exclusive with parentId.',
      },
      insertIndex: {
        type: 'number',
        description: 'Position among parent siblings (0 = first). Omit to append at end. Ignored when replaceId is set (inherits old node index).',
      },
    },
    required: ['markup'],
  },
};
