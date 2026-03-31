/**
 * @file varTool.ts
 * @description Manage Figma variables (design tokens).
 *
 * Replaces: run var (from `run` CLI).
 */

import { ToolDefinition } from '../types';

export const varToolDefinition: ToolDefinition = {
  name: 'var',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Manage Figma variables (design tokens) — list, create, bind, alias.

Actions:
  ls    — list collections & variables
  create — create variable or collection
  bind  — bind variable to node property
  alias — create alias (semantic -> primitive)

Examples:
  var({action: "ls"})
  var({action: "ls", collection: "Theme"})
  var({action: "create", variable: "colors/primary", type: "COLOR", value: "#1A1A1A"})
  var({action: "create", collection: "Theme", modes: "Light,Dark"})
  var({action: "create", variable: "Theme/bg", type: "COLOR", value: "#FFFFFF", mode: "Light"})
  var({action: "create", variable: "Theme/bg", type: "COLOR", value: "#1A1A1A", mode: "Dark"})
  var({action: "create", variable: "spacing/md", type: "FLOAT", value: "16"})
  var({action: "bind", node: "Card#1:2", prop: "fills", variable: "Theme/bg"})
  var({action: "alias", variable: "semantic/text-primary", target: "colors/primary"})

Variable types: COLOR, FLOAT, BOOLEAN, STRING.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '"ls", "create", "bind", or "alias"',
        enum: ['ls', 'create', 'bind', 'alias'],
      },
      collection: {
        type: 'string',
        description: 'Collection name (ls: filter; create: new collection name)',
      },
      variable: {
        type: 'string',
        description: 'Variable path "collection/name" (create, bind, alias)',
      },
      type: {
        type: 'string',
        description: 'Variable type (create only)',
        enum: ['COLOR', 'FLOAT', 'BOOLEAN', 'STRING'],
      },
      value: {
        type: 'string',
        description: 'Variable value — #hex for COLOR, number for FLOAT, true/false, or string',
      },
      modes: {
        type: 'string',
        description: 'Comma-separated mode names for collection creation',
      },
      mode: {
        type: 'string',
        description: 'Target mode for per-mode value setting',
      },
      node: {
        type: 'string',
        description: 'Node ID for binding (e.g. "100:5")',
      },
      prop: {
        type: 'string',
        description: 'Node property to bind (fills, fontSize, paddingTop, etc.)',
      },
      target: {
        type: 'string',
        description: 'Target variable path for alias ("collection/name")',
      },
    },
    required: ['action'],
  },
};
