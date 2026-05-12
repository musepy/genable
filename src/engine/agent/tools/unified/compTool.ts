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
  description: `Create an instance of an existing component. Mutates the canvas — appends a new InstanceNode as the last child of \`parent\` (or the active page root if omitted). The instance is LINKED to the component master, so future component edits propagate. Returns the new instance's nodeId.

Use when:
- Spawning runtime copies of a Component master (buttons, list items, cards)
- Reusing a design-system component in a fresh layout
- Programmatic instantiation outside a jsx() tree-build

Returns: { data: { id: "5:42", name: "Button", componentId: "1:2" } }

Parameters beyond schema:
- \`node\` must be a Component node (not Frame, Text, or another Instance). Discover IDs with find_nodes({ type: "COMPONENT" }).
- \`parent\` optional. If parent is auto-layout, the instance enters the flow and inherits sizing rules. If omitted, the instance is placed at the active page root with detached position — may overlap existing content; set explicit position with edit afterwards.

Skip when:
- Duplicating a non-component node — instance creation will fail; use clone_node instead.
- Building a subtree from scratch — use jsx with <instance ref="ComponentName"/> for atomic single-call construction.

Examples:
  create_instance({node: "1:2"})                    // at page root
  create_instance({node: "1:2", parent: "1:4"})     // inside frame 1:4`,
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
