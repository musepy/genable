/**
 * @file varTool.ts
 * @description Variable (design token) tools — 6 first-class tools.
 *
 * Addressing: pure Figma IDs — `VariableID:x:y`, `VariableCollectionId:x:y`,
 * modeId like `"1:0"`. No path / no name-lookup.
 *
 * Field names are Figma-native: `variableCollectionId`, `resolvedType`, `valuesByMode`.
 */

import { ToolDefinition } from '../types';

export const listVariablesDefinition: ToolDefinition = {
  name: 'list_variables',
  executionStrategy: 'parallel',
  description: `List variables as a flat array with referenced collections.

Returns {data: {variables[], collections[], nextCursor?}}. Each variable carries
its full Figma shape: id, name, variableCollectionId, resolvedType, valuesByMode.
collections[] only includes collections referenced by the returned variables
(use for mode-name resolution).

Parameters:
  collection — VariableCollectionId to filter by
  filter     — substring match on variable name (case-insensitive)
  cursor     — opaque pagination cursor from a previous call
  limit      — max variables per page (default 100)

Examples:
  list_variables()
  list_variables({collection: "VariableCollectionId:1:2"})
  list_variables({filter: "bg"})
  list_variables({cursor: "100"})`,
  parameters: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description: 'VariableCollectionId to filter by',
      },
      filter: {
        type: 'string',
        description: 'Substring match on variable name (case-insensitive)',
      },
      cursor: {
        type: 'string',
        description: 'Opaque pagination cursor from a previous call',
      },
      limit: {
        type: 'number',
        description: 'Max variables per page (default 100)',
      },
    },
  },
};

export const createCollectionDefinition: ToolDefinition = {
  name: 'create_collection',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Create a VariableCollection with named modes.

The first mode in the array becomes the default mode. Returns
{data: {id, modes: [{modeId, name}]}} — use those modeIds with
set_variable_value and set_variable_mode.

Examples:
  create_collection({name: "Theme", modes: ["Light", "Dark"]})
  create_collection({name: "Device", modes: ["Desktop", "Tablet", "Mobile"]})`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Collection name',
      },
      modes: {
        type: 'array',
        description: 'Mode names (first becomes default)',
        items: { type: 'string', description: 'Mode name' },
      },
    },
    required: ['name', 'modes'],
  },
};

export const createVariableDefinition: ToolDefinition = {
  name: 'create_variable',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Create a variable in an existing collection.

No value is set here — use set_variable_value after. Returns {data: {id}}.

Examples:
  create_variable({collection: "VariableCollectionId:1:2", name: "Theme/bg", type: "COLOR"})
  create_variable({collection: "VariableCollectionId:1:2", name: "spacing/md", type: "FLOAT"})`,
  parameters: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description: 'VariableCollectionId to create the variable in',
      },
      name: {
        type: 'string',
        description: 'Variable name (slashes denote hierarchy in the Figma UI)',
      },
      type: {
        type: 'string',
        description: 'Variable type',
        enum: ['COLOR', 'FLOAT', 'BOOLEAN', 'STRING'],
      },
    },
    required: ['collection', 'name', 'type'],
  },
};

export const ensureCollectionDefinition: ToolDefinition = {
  name: 'ensure_collection',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Idempotent VariableCollection creation — safe to retry.

Returns existing collection if one with the same name + identical mode list
already exists, otherwise creates a new one. Spec §3.1.

The "idempotency_key" must be sha256(name + "|" + "STRING" + "|" +
canonical_json({modes: [<mode_names>]})) — random keys are rejected.
Compute the key client-side; the helper "computeVariableIdempotencyKey"
matches this formula when called with collection_id="" and type="STRING".

Returns {data: {collection_id, modes: [{modeId, name}], reused?: true}}.

Examples:
  ensure_collection({name: "Theme", modes: ["Light", "Dark"], idempotency_key: "<sha256>"})`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Collection name' },
      modes: {
        type: 'array',
        description: 'Mode names (first becomes default)',
        items: { type: 'string', description: 'Mode name' },
      },
      idempotency_key: {
        type: 'string',
        description: 'Canonical sha256 idempotency key — see spec §3.1',
      },
    },
    required: ['name', 'modes', 'idempotency_key'],
  },
};

export const ensureVariableDefinition: ToolDefinition = {
  name: 'ensure_variable',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Idempotent variable creation — populates values_by_mode in one shot.

Behavior (spec §3.1):
  - Exactly 1 variable with (collection_id, name, type) in target collection → idempotent reuse.
  - 0 in target, matches in OTHER collections → create new in target + warning NAME_EXISTS_OUTSIDE_TARGET_COLLECTION.
  - 0 anywhere → create new.
  - 2+ in target collection (Figma allows duplicates) → fail SAME_COLLECTION_NAME_DUPLICATE.

values_by_mode keys can be either mode NAMES (e.g. "Light") or modeIds (e.g. "1:0").
Each value must match the variable type (hex/RGBA for COLOR, number for FLOAT,
string for STRING, boolean for BOOLEAN).

idempotency_key formula: sha256(collection_id + "|" + name + "|" + type + "|"
+ canonical_json(values_by_mode)). Random keys rejected.

Returns {data: {variable_id, name, type, collection_id, mode_coverage[],
reused?: true}, warnings?: [...]}.

Examples:
  ensure_variable({collection_id: "VariableCollectionId:1:2", name: "Text/Primary", type: "COLOR", values_by_mode: {Light: "#111", Dark: "#EEE"}, idempotency_key: "<sha256>"})`,
  parameters: {
    type: 'object',
    properties: {
      collection_id: {
        type: 'string',
        description: 'Target VariableCollectionId — strict ID, no name lookup.',
      },
      name: {
        type: 'string',
        description: 'Variable name (slashes denote hierarchy).',
      },
      type: {
        type: 'string',
        description: 'Variable type',
        enum: ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'],
      },
      values_by_mode: {
        type: 'object',
        description: 'Map of mode name OR modeId → value. Hex strings allowed for COLOR.',
      },
      idempotency_key: {
        type: 'string',
        description: 'Canonical sha256 idempotency key — see spec §3.1',
      },
    },
    required: ['collection_id', 'name', 'type', 'values_by_mode', 'idempotency_key'],
  },
};

export const setVariableValueDefinition: ToolDefinition = {
  name: 'set_variable_value',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Set a variable's value for a specific mode.

Thin wrapper over Figma's variable.setValueForMode(modeId, value). Call once per
mode. Value is a raw value (COLOR/FLOAT/STRING/BOOLEAN) OR an alias object
{type: "VARIABLE_ALIAS", id: "VariableID:x:y"}. Hex strings are accepted for
COLOR and normalized to {r,g,b,a} in 0-1 range.

Examples:
  set_variable_value({variable: "VariableID:1:5", mode: "1:0", value: "#FFFFFF"})
  set_variable_value({variable: "VariableID:1:5", mode: "1:1", value: {r: 0.1, g: 0.1, b: 0.1, a: 1}})
  set_variable_value({variable: "VariableID:1:6", mode: "1:0", value: 16})
  set_variable_value({variable: "VariableID:1:7", mode: "1:0", value: {type: "VARIABLE_ALIAS", id: "VariableID:1:9"}})`,
  parameters: {
    type: 'object',
    properties: {
      variable: {
        type: 'string',
        description: 'VariableID to set',
      },
      mode: {
        type: 'string',
        description: 'Mode id from the variable\'s collection (e.g. "1:0")',
      },
      value: {
        type: 'object',
        description: 'Raw value (COLOR/FLOAT/STRING/BOOLEAN) or {type: "VARIABLE_ALIAS", id}',
      },
    },
    required: ['variable', 'mode', 'value'],
  },
};

export const bindVariableDefinition: ToolDefinition = {
  name: 'bind_variable',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Bind a FLOAT, BOOLEAN, or STRING variable to a node property.

prop is a flat Figma bindable field (e.g. fontSize, itemSpacing, paddingTop,
cornerRadius, opacity, visible, width, height, characters). Shorthands:
gap → itemSpacing, padding → paddingTop, corner → cornerRadius,
font-size → fontSize.

COLOR variables are NOT bound here — they live inside Paint objects. To apply
a color token, specify it at the source instead:
  • At creation:  jsx <frame bg="$TokenName" ...> or fill="$TokenName"
  • Post-hoc:     set_fill({node, bg: "$TokenName"}) or set_stroke

When selecting which variable to bind: if the node is a Tablet or Mobile variant
(name or variant property contains "Tablet"/"Mobile"), match the node's property
value against the Tablet/Mobile mode column from list_variables — not Desktop.

Examples:
  bind_variable({node: "1:2", prop: "fontSize", variable: "VariableID:1:6"})
  bind_variable({node: "1:3", prop: "paddingTop", variable: "VariableID:1:7"})
  bind_variable({node: "1:4", prop: "visible", variable: "VariableID:1:8"})
  bind_variable({node: "1:5", prop: "characters", variable: "VariableID:1:9"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ID (e.g. "1:2")',
      },
      prop: {
        type: 'string',
        description: 'Flat Figma bindable field (fontSize, paddingTop, itemSpacing, visible, characters, etc.). COLOR props (fills/strokes) not supported — use set_fill/jsx.',
      },
      variable: {
        type: 'string',
        description: 'VariableID to bind (FLOAT/BOOLEAN/STRING only)',
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
  set_variable_mode({node: "1:2", collection: "VariableCollectionId:1:2", mode: "1:1"})
  set_variable_mode({node: "1:5", collection: "VariableCollectionId:1:3", mode: "1:2"})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Node ID (e.g. "1:2")',
      },
      collection: {
        type: 'string',
        description: 'VariableCollectionId',
      },
      mode: {
        type: 'string',
        description: 'Mode id (e.g. "1:1")',
      },
    },
    required: ['node', 'collection', 'mode'],
  },
};
