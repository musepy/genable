/**
 * @file structureTool.ts
 * @description Structure tools — verb_noun first-class tools.
 *
 * 3 tools replacing the old `structure({action})` action-routed pattern.
 */

import { ToolDefinition } from '../types';

export const deleteNodeDefinition: ToolDefinition = {
  name: 'delete_node',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Delete a node and its children.

Examples:
  delete_node({node: "Card#1:2"})
  delete_node({node: "/Card/Placeholder*"})

Supports glob patterns to delete multiple matching children.`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ref ("name#id") or glob pattern ("/Card/Old*")',
      },
    },
    required: ['node'],
  },
};

export const moveNodeDefinition: ToolDefinition = {
  name: 'move_node',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Move, rename, or reorder a node.

Examples:
  move_node({node: "Title#1:3", name: "NewTitle"})
  move_node({node: "Logo#1:3", dest: "Footer#1:4"})
  move_node({node: "Item#1:5", index: 0})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ref ("name#id") to move/rename',
      },
      dest: {
        type: 'string',
        description: 'Destination parent node ref',
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
  description: `Deep-copy a node with optional property overrides.

Examples:
  clone_node({node: "Card#1:2", dest: "/Card/Hover/"})
  clone_node({node: "Card#1:2", dest: "/Card/Disabled/", overrides: {"bg": "#D9D9D9", "Label.fill": "#999"}})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Source node ref ("name#id")',
      },
      dest: {
        type: 'string',
        description: 'Destination path with name',
      },
      overrides: {
        type: 'object',
        description: 'Property overrides. Use "Child.prop" for child overrides.',
      },
    },
    required: ['node', 'dest'],
  },
};
