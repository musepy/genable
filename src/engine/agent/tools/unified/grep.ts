import { ToolDefinition } from '../types';

/**
 * Search nodes or discover property values — like Unix grep.
 * Replaces: query nodes + replace search.
 */
export const grepDefinition: ToolDefinition = {
  name: 'grep',
  category: 'read',
  display: { displayName: 'Search', group: 'inspect' },
  executionStrategy: 'parallel',
  description: `Search nodes by name/type or discover property values in a subtree.

**Node search** (first arg is NOT a ref):
  grep Button              → find nodes named "Button" on page
  grep frame               → find all frame nodes

**Property discovery** (first arg IS a ref):
  grep Card#1:2 fillColor,fontSize  → discover unique values in subtree

Node addressing: use Name#id refs from jsx/inspect results.
Property discovery returns all unique values found in the subtree.
Supported properties: fillColor, textColor, strokeColor, strokeWeight, opacity, cornerRadius, gap, fontSize, fontFamily, fontWeight.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Node name/type to search, or property names to discover.',
      },
      path: {
        type: 'string',
        description: 'Node ref (Name#id) or path for scope/subtree root.',
      },
      properties: {
        type: 'array',
        description: 'For property discovery: list of property names.',
        items: { type: 'string', description: 'Property name' },
      },
    },
    required: [],
  },
  errors: {
    PATH_NOT_FOUND: 'No node found at the given path.',
    SEARCH_ERROR: 'An error occurred while searching.',
    NO_RESULTS: 'No matching results found.',
  },
};
