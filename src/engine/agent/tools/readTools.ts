/**
 * @file readTools.ts
 * @description Tools for reading Figma state (selection, variables, styles, DSL).
 */

import { ToolDefinition } from './types';

/**
 * Tool to get the current selection in Figma.
 */
export const getSelectionDefinition: ToolDefinition = {
  name: 'getSelection',
  category: 'read',
  dependencies: [],
  description: 'Get the currently selected nodes in Figma. Returns a list of node names, types, and IDs.',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  executionStrategy: 'parallel'
};

/**
 * Tool to get available local variables in the Figma document.
 */
export const getVariablesDefinition: ToolDefinition = {
  name: 'getVariables',
  category: 'read',
  dependencies: [],
  description: 'List available local variables (design tokens) in the current Figma document.',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  executionStrategy: 'parallel'
};

/**
 * Tool to get available local paint styles in Figma.
 */
export const getStylesDefinition: ToolDefinition = {
  name: 'getStyles',
  category: 'read',
  dependencies: [],
  description: 'List available local paint styles in the current Figma document.',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  executionStrategy: 'parallel'
};

/**
 * Tool to get the full DSL representation of a specific node.
 */
export const getNodeDSLDefinition: ToolDefinition = {
  name: 'getNodeDSL',
  category: 'read',
  dependencies: [],
  description: 'Retrieve the full DSL (serialized structure) of a specific node by its ID.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'The ID of the node to inspect.'
      }
    },
    required: ['nodeId']
  },
  executionStrategy: 'parallel'
};
