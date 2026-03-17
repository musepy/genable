/**
 * @file comp.ts
 * @description Component/variant management command — create, combine, properties, instances.
 *
 * CLI form: comp create, comp combine, comp prop, comp ls, comp instance
 * Subcommand-based: first positional arg selects the operation.
 */

import { ToolDefinition } from '../types';

export const compDefinition: ToolDefinition = {
  name: 'comp',
  category: 'create',
  display: { displayName: 'Component', group: 'design-system' },
  executionStrategy: 'sequential',
  description: `Manage Figma components and variants.

Subcommands:
  comp create <path>                                 convert frame to component
  comp combine <path1> <path2> ... [--name <name>]   combine components as variant set
  comp prop <path> <propName> <TYPE> [defaultValue]  add component property (TEXT, BOOLEAN, INSTANCE_SWAP)
  comp ls <path>                                     list component properties & variants
  comp instance <path> [--parent <destPath>]         create instance of component

Examples:
  comp create /Button/Primary
  comp combine /Button/Primary /Button/Secondary /Button/Ghost --name Button
  comp prop /Button/ Label TEXT "Click me"
  comp prop /Button/ "Has Icon" BOOLEAN false
  comp ls /Button/
  comp instance /Button/ --parent /Card/Actions/`,
  parameters: {
    type: 'object',
    properties: {
      subcommand: {
        type: 'string',
        description: 'Subcommand: create, combine, prop, ls, instance',
      },
      paths: {
        type: 'array',
        description: 'Node path(s)',
        items: { type: 'string', description: 'Path' },
      },
      name: { type: 'string', description: 'Name for component set or property name' },
      propType: { type: 'string', description: 'Property type: TEXT, BOOLEAN, INSTANCE_SWAP' },
      defaultValue: { type: 'string', description: 'Default value for component property' },
      parent: { type: 'string', description: 'Parent path for instance placement' },
    },
    required: [],
  },
  errors: {
    NOT_A_FRAME: 'Target node is not a frame — cannot convert to component.',
    NOT_A_COMPONENT: 'Target node is not a component.',
    COMBINE_REQUIRES_2: 'Combine requires at least 2 components.',
    PROP_FAILED: 'Failed to add component property.',
    MISSING_ARG: 'Required argument missing.',
  },
};
