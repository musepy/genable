/**
 * @file structureTool.ts
 * @description Structure tools — verb_noun first-class tools.
 *
 * 3 tools replacing the old `structure({action})` action-routed pattern.
 */

import { ToolDefinition } from '../types';
import { keepFields } from './keepFields';

export const deleteNodeDefinition: ToolDefinition = {
  name: 'delete_node',
  executionStrategy: 'sequential',
  mutates: true,
  presentForLLM: (data) => keepFields(data, ['deleted']),
  description: `Delete a node and its children.

Examples:
  delete_node({node: "1:2"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ID (e.g. "1:2")',
      },
    },
    required: ['node'],
  },
};

export const moveNodeDefinition: ToolDefinition = {
  name: 'move_node',
  executionStrategy: 'sequential',
  mutates: true,
  presentForLLM: (data) => keepFields(data, ['id', 'name']),
  description: `Relocate a node without recreating it. Preserves IDs, bound variables, and component instances across the move, so callers tracking the node by ID never need to re-discover it. Use for: (a) changing child order within a container, (b) moving a subtree into a different parent, (c) fixing a placement mistake after jsx.

Examples:
  move_node({node: "1:3", name: "NewTitle"})         — rename in place
  move_node({node: "1:3", parent: "1:4"})            — move into parent 1:4
  move_node({node: "1:5", index: 0})                 — reorder within current parent`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ID (e.g. "1:3") to move/rename',
      },
      parent: {
        type: 'string',
        description: 'Target parent node ID — the frame/container the node should live inside after the call',
      },
      name: {
        type: 'string',
        description: 'New name (rename without changing parent)',
      },
      index: {
        type: 'number',
        description: 'Reorder position among siblings. 0 = first, -1 = last.',
      },
    },
    required: ['node'],
  },
};

export const cloneNodeDefinition: ToolDefinition = {
  name: 'clone_node',
  executionStrategy: 'sequential',
  mutates: true,
  presentForLLM: (data) => keepFields(data, ['idMap']),
  description: `Deep-copy a node with optional property overrides.

Examples:
  clone_node({node: "1:2"})                                 — clone to page root, same name
  clone_node({node: "1:2", parent: "/"})                    — clone to page root explicitly
  clone_node({node: "1:2", parent: "/", name: "Hero Copy"}) — clone to root with custom name
  clone_node({node: "1:2", parent: "1:4"})                  — clone into parent node 1:4
  clone_node({node: "1:2", parent: "1:4", overrides: {"bg": "#D9D9D9"}})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Source node ID (e.g. "1:2")',
      },
      parent: {
        type: 'string',
        description: 'Target parent node ID the clone should live inside, or "/" for page root. Defaults to page root.',
      },
      name: {
        type: 'string',
        description: 'Name for the cloned node. Defaults to source node name.',
      },
      overrides: {
        type: 'object',
        description: 'Property overrides. Use "Child.prop" for child overrides.',
      },
    },
    required: ['node'],
  },
};
