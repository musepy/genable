/**
 * @file compTool.ts
 * @description Manage Figma components and variants.
 *
 * Replaces: run comp (from `run` CLI).
 */

import { ToolDefinition } from '../types';

export const compToolDefinition: ToolDefinition = {
  name: 'comp',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Manage Figma components and variants — create, combine, add props, list, instantiate.

Actions:
  create   — convert frame to component
  combine  — combine components into variant set
  prop     — add component property
  ls       — list component properties & variants
  instance — create instance of component

Examples:
  comp({action: "create", node: "Button#1:2"})
  comp({action: "combine", nodes: ["Btn1#1:2", "Btn2#1:3"], name: "Button"})
  comp({action: "prop", node: "Button#1:2", name: "Label", type: "TEXT", default: "Click me"})
  comp({action: "prop", node: "Button#1:2", name: "Has Icon", type: "BOOLEAN", default: "false"})
  comp({action: "ls", node: "Button#1:2"})
  comp({action: "instance", node: "Button#1:2", parent: "Card#1:4"})

Property types: TEXT, BOOLEAN, INSTANCE_SWAP.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '"create", "combine", "prop", "ls", or "instance"',
        enum: ['create', 'combine', 'prop', 'ls', 'instance'],
      },
      node: {
        type: 'string',
        description: 'Target node ID (e.g. "100:5")',
      },
      nodes: {
        type: 'array',
        description: 'Multiple node refs (combine only)',
        items: { type: 'string', description: 'Node ref' },
      },
      name: {
        type: 'string',
        description: 'Component set name (combine) or property name (prop)',
      },
      type: {
        type: 'string',
        description: 'Component property type (prop only)',
        enum: ['TEXT', 'BOOLEAN', 'INSTANCE_SWAP'],
      },
      default: {
        type: 'string',
        description: 'Default value for component property',
      },
      parent: {
        type: 'string',
        description: 'Parent node ref for instance placement',
      },
    },
    required: ['action'],
  },
};
