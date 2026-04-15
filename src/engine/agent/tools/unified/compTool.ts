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
  create_component({node: "1:2"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ID (e.g. "1:2") to convert',
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
  combine_components({nodes: ["1:2", "1:3", "1:4"], name: "Button"})`,
  parameters: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: 'Component node IDs to combine',
        items: { type: 'string', description: 'Node ID' },
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
  description: `Add a component property and bind it to a child node.

For TEXT properties: binds to the target text node's characters, so instances can override the text content.
For BOOLEAN properties: binds to the target node's visibility.

Parameters:
  node: The component node ID (must be COMPONENT or COMPONENT_SET).
  name: Property display name.
  type: TEXT, BOOLEAN, or INSTANCE_SWAP.
  default: Default value.
  bind: Child node ID to bind this property to. For TEXT, binds to text content. For BOOLEAN, binds to visibility.

Examples:
  add_component_prop({node: "1:2", name: "Label", type: "TEXT", default: "Click me", bind: "1:5"})
  add_component_prop({node: "1:2", name: "Show Icon", type: "BOOLEAN", default: "true", bind: "1:6"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Component node ID (e.g. "1:2")',
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
      bind: {
        type: 'string',
        description: 'Child node ID to bind this property to',
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
  list_component_props({node: "1:2"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Component/instance node ID (e.g. "1:2")',
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
  create_instance({node: "1:2"})
  create_instance({node: "1:2", parent: "1:4"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Component node ID (e.g. "1:2") to instantiate',
      },
      parent: {
        type: 'string',
        description: 'Parent node ID for placement',
      },
    },
    required: ['node'],
  },
};
