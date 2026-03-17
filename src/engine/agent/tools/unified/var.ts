/**
 * @file var.ts
 * @description Variable management command — create, list, bind, alias Figma variables.
 *
 * CLI form: var ls, var mk, var bind, var alias
 * Subcommand-based: first positional arg selects the operation.
 */

import { ToolDefinition } from '../types';

export const varDefinition: ToolDefinition = {
  name: 'var',
  category: 'create',
  display: { displayName: 'Variable', group: 'design-system' },
  executionStrategy: 'sequential',
  description: `Manage Figma variables — collections, modes, values, bindings.

Subcommands:
  var ls [collection]                              list collections & variables
  var mk <collection/name> <TYPE> <value>          create variable (COLOR, FLOAT, BOOLEAN, STRING)
  var mk --collection <name> [--modes A,B]         create collection with optional modes
  var mk <collection/name> <value> --mode <mode>   set value for specific mode
  var bind <node-path> <prop> <collection/name>    bind variable to node property
  var alias <collection/name> <target/name>        create alias (semantic → primitive)

Examples:
  var ls
  var ls Theme
  var mk colors/primary COLOR #1A1A1A
  var mk --collection Theme --modes Light,Dark
  var mk Theme/bg COLOR #FFFFFF --mode Light
  var mk Theme/bg COLOR #1A1A1A --mode Dark
  var mk spacing/md FLOAT 16
  var bind /Card/ fills Theme/bg
  var bind /Card/Title fontSize Typography/heading-size
  var alias semantic/text-primary colors/primary`,
  parameters: {
    type: 'object',
    properties: {
      subcommand: {
        type: 'string',
        description: 'Subcommand: ls, mk, bind, alias',
      },
      collection: { type: 'string', description: 'Collection name (for ls filter or mk-collection)' },
      variable: { type: 'string', description: 'Variable path (collection/name)' },
      varType: { type: 'string', description: 'Variable type: COLOR, FLOAT, BOOLEAN, STRING' },
      value: { type: 'string', description: 'Variable value (#hex, number, true/false, string)' },
      modes: { type: 'string', description: 'Comma-separated mode names for collection creation' },
      mode: { type: 'string', description: 'Target mode name for per-mode value setting' },
      nodePath: { type: 'string', description: 'Node path for binding (e.g. /Card/Title)' },
      property: { type: 'string', description: 'Node property to bind (fills, fontSize, paddingTop, etc.)' },
      target: { type: 'string', description: 'Target variable path for aliases' },
    },
    required: [],
  },
  errors: {
    COLLECTION_NOT_FOUND: 'Variable collection not found.',
    VARIABLE_NOT_FOUND: 'Variable not found.',
    INVALID_TYPE: 'Invalid variable type. Use: COLOR, FLOAT, BOOLEAN, STRING.',
    BIND_FAILED: 'Failed to bind variable to node property.',
    MODE_NOT_FOUND: 'Mode not found in collection.',
    MISSING_ARG: 'Required argument missing.',
  },
};
