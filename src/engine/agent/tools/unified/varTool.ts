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
  description: `List variable collections and variables, including per-mode values.

Returns structured data with every variable's value in every mode of its collection —
enough to render a full variable table without further calls.

Shape:
  {
    listing: "<human-readable summary>",
    count: <total variable count>,
    collections: [
      {
        id, name,
        modes: [{id, name}, ...],
        variables: [
          {
            id, name, type,            // type: COLOR | FLOAT | BOOLEAN | STRING
            valuesByMode: {
              "<modeName>": {value: "#FFFFFF"}          // literal (COLOR as #hex, FLOAT as number, etc.)
              "<modeName>": {alias: "colors/gray-900", aliasId: "..."}  // alias to another variable
            }
          }, ...
        ]
      }, ...
    ]
  }

Examples:
  list_variables()                        // all collections, all variables, all modes
  list_variables({collection: "Theme"})   // filter by collection name (substring match)`,
  parameters: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description: 'Filter by collection name (substring, case-insensitive)',
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
  bind_variable({node: "1:2", prop: "fills", variable: "Theme/bg"})
  bind_variable({node: "1:3", prop: "fontSize", variable: "sizing/heading"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ID (e.g. "1:2")',
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

export const setVariableModeDefinition: ToolDefinition = {
  name: 'set_variable_mode',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Set a node to use a specific mode of a variable collection.

This controls which variable values the node displays. For example, set a frame
to use "Dark" mode of the "Theme" collection so all bound variables show dark values.

Examples:
  set_variable_mode({node: "1:2", collection: "Theme", mode: "Dark"})
  set_variable_mode({node: "1:5", collection: "Device", mode: "Mobile"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ID (e.g. "1:2")',
      },
      collection: {
        type: 'string',
        description: 'Variable collection name (e.g. "Theme")',
      },
      mode: {
        type: 'string',
        description: 'Mode name to activate (e.g. "Dark")',
      },
    },
    required: ['node', 'collection', 'mode'],
  },
};

export const aliasVariableDefinition: ToolDefinition = {
  name: 'alias_variable',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Create a per-mode variable alias (semantic → primitive).

mode is required. Call once per mode to set different aliases per mode.

Examples:
  alias_variable({variable: "Theme/bg", target: "colors/white", mode: "Light"})
  alias_variable({variable: "Theme/bg", target: "colors/gray-900", mode: "Dark"})`,
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
      mode: {
        type: 'string',
        description: 'Mode name to set this alias for (e.g. "Light", "Dark"). Required.',
      },
    },
    required: ['variable', 'target', 'mode'],
  },
};
