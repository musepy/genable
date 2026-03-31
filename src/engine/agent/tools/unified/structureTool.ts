/**
 * @file structureTool.ts
 * @description Modify the design tree structure — move, delete, or clone nodes.
 *
 * Replaces: mv + rm + cp (from `run` CLI).
 */

import { ToolDefinition } from '../types';

export const structureDefinition: ToolDefinition = {
  name: 'structure',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Modify the design tree structure — move, delete, or clone nodes.

Actions:
  delete — remove a node and its children
  move   — move or rename a node
  clone  — deep-copy a node with optional overrides

Examples:
  structure({action: "delete", node: "Card#1:2"})
  structure({action: "delete", node: "/Card/Placeholder*"})
  structure({action: "move", node: "Title#1:3", name: "NewTitle"})
  structure({action: "move", node: "Logo#1:3", dest: "Footer#1:4"})
  structure({action: "move", node: "Item#1:5", index: 0})
  structure({action: "clone", node: "Card#1:2", dest: "/Card/Hover/"})
  structure({action: "clone", node: "Card#1:2", dest: "/Card/Disabled/", overrides: "{bg:#D9D9D9, Label.fill:#999}"})

Node addressing: use Name#id refs from jsx/inspect results. "/" = page root. Glob: /Card/Old* matches children by pattern.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '"move", "delete", or "clone"',
        enum: ['move', 'delete', 'clone'],
      },
      node: {
        type: 'string',
        description: 'Target node ref ("name#id" or glob pattern like "/Card/Old*")',
      },
      dest: {
        type: 'string',
        description: 'Destination node ref or path (move: new parent; clone: dest path with name)',
      },
      name: {
        type: 'string',
        description: 'New name for move/rename (without changing parent)',
      },
      index: {
        type: 'number',
        description: 'Reorder position among siblings (move only). 0 = first, -1 = last.',
      },
      overrides: {
        type: 'string',
        description: 'Clone property overrides: "{bg:#EEE}" or "{bg:#EEE, Label.fill:#999}"',
      },
    },
    required: ['action', 'node'],
  },
};
