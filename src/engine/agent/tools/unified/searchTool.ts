/**
 * @file searchTool.ts
 * @description Search tools — verb_noun first-class tools.
 *
 * 3 tools replacing the old `search({mode inferred})` pattern.
 */

import { ToolDefinition } from '../types';

export const findNodesDefinition: ToolDefinition = {
  name: 'find_nodes',
  executionStrategy: 'parallel',
  description: `Search nodes by name or type.

Examples:
  find_nodes({query: "Button"})
  find_nodes({query: "frame", scope: "Card#1:2"})`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query — matches node name or type',
      },
      scope: {
        type: 'string',
        description: 'Limit search to subtree. Node ref ("name#id"). Default: entire page.',
      },
    },
    required: ['query'],
  },
};

export const discoverPropsDefinition: ToolDefinition = {
  name: 'discover_props',
  executionStrategy: 'parallel',
  description: `Discover unique property values in a subtree.

Examples:
  discover_props({node: "Card#1:2", props: ["fillColor", "fontSize"]})

Searchable properties: fillColor, textColor, strokeColor, strokeWeight, opacity, cornerRadius, gap, fontSize, fontFamily, fontWeight.`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Target node ref ("name#id")',
      },
      props: {
        type: 'array',
        description: 'Properties to discover',
        items: { type: 'string', description: 'Property name' },
      },
    },
    required: ['node', 'props'],
  },
};

export const replacePropsDefinition: ToolDefinition = {
  name: 'replace_props',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Batch search-and-replace property values in a subtree.

Examples:
  replace_props({node: "Card#1:2", rules: [{prop: "fillColor", from: "#FFF", to: "#000"}]})
  replace_props({node: "Card#1:2", rules: [
    {prop: "fillColor", from: "#FFF", to: "#000"},
    {prop: "fontSize", from: "14", to: "16"}
  ]})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Target node ref ("name#id")',
      },
      rules: {
        type: 'array',
        description: 'Replacement rules',
        items: {
          type: 'object',
          description: '{prop, from, to}',
          properties: {
            prop: { type: 'string', description: 'Property name' },
            from: { type: 'string', description: 'Value to find' },
            to: { type: 'string', description: 'Value to replace with' },
          },
          required: ['prop', 'from', 'to'],
        },
      },
    },
    required: ['node', 'rules'],
  },
};
