/**
 * @file varTool.ts
 * @description Variable (design token) tools — verb_noun first-class tools.
 *
 * 4 tools replacing the old `var({action})` action-routed pattern.
 */

import { ToolDefinition } from '../types';

export const listVariablesDefinition: ToolDefinition = {
  name: 'list_variables',
  executionStrategy: 'parallel',
  description: `List variable collections and variables.

Examples:
  list_variables()
  list_variables({collection: "Theme"})`,
  parameters: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description: 'Filter by collection name',
      },
    },
  },
};

export const createVariableDefinition: ToolDefinition = {
  name: 'create_variable',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Create a variable or variable collection.

Variable: provide variable + type + value.
Collection: provide collection (+ optional modes).

Examples:
  create_variable({variable: "colors/primary", type: "COLOR", value: "#1A1A1A"})
  create_variable({collection: "Theme", modes: ["Light", "Dark"]})
  create_variable({variable: "Theme/bg", type: "COLOR", value: "#FFFFFF", mode: "Light"})
  create_variable({variable: "spacing/md", type: "FLOAT", value: "16"})

Variable types: COLOR, FLOAT, BOOLEAN, STRING.`,
  parameters: {
    type: 'object',
    properties: {
      variable: {
        type: 'string',
        description: 'Variable path "collection/name"',
      },
      type: {
        type: 'string',
        description: 'Variable type',
        enum: ['COLOR', 'FLOAT', 'BOOLEAN', 'STRING'],
      },
      value: {
        type: 'string',
        description: 'Variable value — #hex for COLOR, number for FLOAT, true/false, or string',
      },
      collection: {
        type: 'string',
        description: 'Collection name (for collection creation)',
      },
      modes: {
        type: 'array',
        description: 'Mode names for collection creation',
        items: { type: 'string', description: 'Mode name' },
      },
      mode: {
        type: 'string',
        description: 'Target mode for per-mode value setting',
      },
    },
  },
};

export const bindVariableDefinition: ToolDefinition = {
  name: 'bind_variable',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Bind a variable to a node property.

Examples:
  bind_variable({node: "Card#1:2", prop: "fills", variable: "Theme/bg"})
  bind_variable({node: "Title#1:3", prop: "fontSize", variable: "sizing/heading"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ref ("name#id")',
      },
      prop: {
        type: 'string',
        description: 'Node property to bind (fills, fontSize, paddingTop, etc.)',
      },
      variable: {
        type: 'string',
        description: 'Variable path "collection/name"',
      },
    },
    required: ['node', 'prop', 'variable'],
  },
};

export const aliasVariableDefinition: ToolDefinition = {
  name: 'alias_variable',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Create a variable alias (semantic → primitive).

Examples:
  alias_variable({variable: "semantic/text-primary", target: "colors/primary"})`,
  parameters: {
    type: 'object',
    properties: {
      variable: {
        type: 'string',
        description: 'Source variable path "collection/name"',
      },
      target: {
        type: 'string',
        description: 'Target variable path "collection/name"',
      },
    },
    required: ['variable', 'target'],
  },
};
