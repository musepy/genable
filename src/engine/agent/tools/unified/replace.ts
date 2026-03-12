import { ToolDefinition } from '../types';

/**
 * Batch property search and replace across a node subtree.
 * Two modes:
 *   - search: discover all unique values for specified properties
 *   - replace: from→to precise value replacement
 */
export const replaceDefinition: ToolDefinition = {
  name: 'replace',
  category: 'modify',
  display: { displayName: 'Replace', group: 'design' },
  executionStrategy: 'sequential',
  idempotent: false,
  dependencies: ['inspect'],
  description: `Batch search or replace properties across an entire node subtree. Two modes:

**Search mode** — discover all unique values for specified properties:
\`\`\`json
replace({
  "mode": "search",
  "rootId": "100:5",
  "properties": ["fillColor", "fontSize"]
})
\`\`\`
→ \`{ fillColor: ["#3B82F6", "#EF4444", "#FFF"], fontSize: [14, 16, 20] }\`

**Replace mode** — precise from→to value replacement across the subtree:
\`\`\`json
replace({
  "mode": "replace",
  "rootId": "100:5",
  "replacements": {
    "fillColor": [{ "from": "#3B82F6", "to": "#8B5CF6" }],
    "fontSize": [{ "from": 14, "to": 16 }]
  }
})
\`\`\`
→ \`{ replaced: 12, details: { fillColor: 8, fontSize: 4 } }\`

**Supported properties** (10): fillColor, textColor, strokeColor, strokeWeight, opacity, cornerRadius, gap, fontSize, fontFamily, fontWeight

Use search mode first to discover current values, then replace mode to batch-update them. Much more efficient than multiple \`design\` edit calls for bulk style changes (e.g., rebranding colors, adjusting typography scale).`,
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: '"search" to discover unique property values, "replace" to batch-replace values.',
        enum: ['search', 'replace'],
      },
      rootId: {
        type: 'string',
        description: 'Root node ID — the subtree to search/replace within.',
      },
      properties: {
        type: 'array',
        description: 'For search mode: list of property names to discover. One of: fillColor, textColor, strokeColor, cornerRadius, gap, fontSize, fontFamily, fontWeight.',
        items: { type: 'string', description: 'Property name' },
      },
      replacements: {
        type: 'object',
        description: 'For replace mode: property name → array of {from, to} pairs.',
      },
    },
    required: ['mode', 'rootId'],
  },
  errors: {
    INVALID_MODE: 'Mode must be "search" or "replace".',
    NODE_NOT_FOUND: 'Root node not found.',
    MISSING_PROPERTIES: 'Search mode requires a non-empty "properties" array.',
    MISSING_REPLACEMENTS: 'Replace mode requires a non-empty "replacements" object.',
    EXECUTION_ERROR: 'An unexpected error occurred during replace.',
  },
};

/** Supported property names for replace tool. */
export const REPLACE_PROPERTIES = [
  'fillColor', 'textColor', 'strokeColor', 'strokeWeight', 'opacity',
  'cornerRadius', 'gap', 'fontSize', 'fontFamily', 'fontWeight',
] as const;

export type ReplaceProperty = (typeof REPLACE_PROPERTIES)[number];
