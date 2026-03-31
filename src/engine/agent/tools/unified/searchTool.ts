/**
 * @file searchTool.ts
 * @description Search nodes and properties, or batch-replace values.
 *
 * Replaces: grep + sed (from `run` CLI).
 * Three modes: find (default), discover, replace — inferred from params.
 */

import { ToolDefinition } from '../types';

export const searchDefinition: ToolDefinition = {
  name: 'search',
  executionStrategy: 'parallel',
  description: `Search nodes and properties, or batch-replace values.

Modes (inferred from params):
  find     — search nodes by name/type (default)
  discover — discover property values in a subtree
  replace  — batch search-and-replace properties

Examples:
  search({query: "Button"})
  search({query: "frame", scope: "Card#1:2"})
  search({node: "Card#1:2", props: ["fillColor", "fontSize"]})
  search({node: "Card#1:2", replace: "fillColor:#FFF/#000"})
  search({node: "Card#1:2", replace: "fontSize:14/16 cornerRadius:8/12"})

Searchable properties: fillColor, textColor, strokeColor, strokeWeight, opacity, cornerRadius, gap, fontSize, fontFamily, fontWeight.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query — matches node name or type. Triggers find mode.',
      },
      scope: {
        type: 'string',
        description: 'Limit search to subtree. Node ID (e.g. "100:5"). Default: entire page.',
      },
      node: {
        type: 'string',
        description: 'Target node ID (e.g. "100:5"). Required for discover/replace modes.',
      },
      props: {
        type: 'array',
        description: 'Properties to discover. Triggers discover mode.',
        items: { type: 'string', description: 'Property name' },
      },
      replace: {
        type: 'string',
        description: 'Replacement rules string: "prop:from/to [prop:from/to ...]". Triggers replace mode.',
      },
    },
  },
};
