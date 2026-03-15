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

**Node search** (first arg is NOT a path):
  grep Button              → find nodes named "Button" on page
  grep frame               → find all frame nodes

**Property discovery** (first arg IS a path):
  grep /Card/ fillColor,fontSize    → discover unique values
  grep /100:5/ textColor            → by node ID

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
        description: 'Path scope for node search, or subtree root for property discovery.',
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
