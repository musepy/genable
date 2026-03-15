import { ToolDefinition } from '../types';

/**
 * Batch property replacement — like Unix sed.
 * Replaces: replace (apply mode).
 */
export const sedDefinition: ToolDefinition = {
  name: 'sed',
  category: 'modify',
  display: { displayName: 'Replace', group: 'design' },
  executionStrategy: 'sequential',
  description: `Batch search-and-replace property values across a subtree — like Unix sed.

**Syntax**: \`sed /path/ prop:from/to [prop:from/to ...]\`

**Examples**:
  sed /Card/ fillColor:#3B82F6/#8B5CF6
  sed /Card/ fontSize:14/16 cornerRadius:8/12
  sed /100:5/ textColor:#000/#FFF fillColor:#FFF/#1A1A2E

Each \`prop:from/to\` pair replaces all occurrences of \`from\` with \`to\` in the subtree.
Supported properties: fillColor, textColor, strokeColor, strokeWeight, opacity, cornerRadius, gap, fontSize, fontFamily, fontWeight.

Returns: { replaced: N, details: { prop: count } }`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Root path for the subtree to replace within.',
      },
      replacements: {
        type: 'object',
        description: 'Property replacements: { prop: [{from, to}] }',
      },
    },
    required: ['path'],
  },
  errors: {
    PATH_NOT_FOUND: 'No node found at the given path.',
    MISSING_REPLACEMENTS: 'No replacement rules provided.',
    EXECUTION_ERROR: 'An error occurred during replacement.',
  },
};
