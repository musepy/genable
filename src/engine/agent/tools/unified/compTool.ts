/**
 * @file compTool.ts
 * @description Component tools — verb_noun first-class tools.
 *
 * 5 tools replacing the old `comp({action})` action-routed pattern.
 */

import { ToolDefinition } from '../types';

export const createComponentDefinition: ToolDefinition = {
  name: 'create_component',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Convert a frame or group to a Figma component.

Examples:
  create_component({node: "Button#1:2"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ref ("name#id") to convert',
      },
    },
    required: ['node'],
  },
};

export const combineComponentsDefinition: ToolDefinition = {
  name: 'combine_components',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Combine multiple components into a variant set (ComponentSet).

Examples:
  combine_components({nodes: ["Base#1:2", "Hover#1:3", "Disabled#1:4"], name: "Button"})`,
  parameters: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: 'Component node refs to combine',
        items: { type: 'string', description: 'Node ref' },
      },
      name: {
        type: 'string',
        description: 'Component set name',
      },
    },
    required: ['nodes'],
  },
};

export const addComponentPropDefinition: ToolDefinition = {
  name: 'add_component_prop',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Add a component property.

Examples:
  add_component_prop({node: "Button#1:2", name: "Label", type: "TEXT", default: "Click me"})
  add_component_prop({node: "Button#1:2", name: "Has Icon", type: "BOOLEAN", default: "false"})

Property types: TEXT, BOOLEAN, INSTANCE_SWAP.`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Component node ref ("name#id")',
      },
      name: {
        type: 'string',
        description: 'Property name',
      },
      type: {
        type: 'string',
        description: 'Property type',
        enum: ['TEXT', 'BOOLEAN', 'INSTANCE_SWAP'],
      },
      default: {
        type: 'string',
        description: 'Default value',
      },
    },
    required: ['node', 'name', 'type'],
  },
};

export const listComponentPropsDefinition: ToolDefinition = {
  name: 'list_component_props',
  executionStrategy: 'parallel',
  description: `List properties and variants of a component, component set, or instance.

Examples:
  list_component_props({node: "Button#1:2"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Component/instance node ref ("name#id")',
      },
    },
    required: ['node'],
  },
};

export const createInstanceDefinition: ToolDefinition = {
  name: 'create_instance',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Create an instance of a component.

Examples:
  create_instance({node: "Button#1:2"})
  create_instance({node: "Button#1:2", parent: "Card#1:4"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Component node ref ("name#id") to instantiate',
      },
      parent: {
        type: 'string',
        description: 'Parent node ref for placement',
      },
    },
    required: ['node'],
  },
};
