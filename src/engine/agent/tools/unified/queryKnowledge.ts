import { ToolDefinition } from '../types';

/**
 * Unified knowledge query — replaces searchDesignKnowledge, getProjectUIContext, getDesignSystemTokens, listProjectComponents.
 */
export const queryKnowledgeDefinition: ToolDefinition = {
  name: 'query_knowledge',
  category: 'knowledge',
  description: `Query design knowledge, project components, or design tokens. This is the ONLY tool for accessing design reference information.

Sources:
- "knowledge": Search design patterns, spacing rules, typography conventions, and responsive guidelines.
- "components": Get project UI component specifications (names, categories, usage).
- "tokens": Get design system tokens (colors, spacing, typography scales).`,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['knowledge', 'components', 'tokens'],
        description: 'What to query: "knowledge" for design patterns, "components" for UI components, "tokens" for design tokens.'
      },
      query: {
        type: 'string',
        description: 'Search query or filter. For "knowledge": natural language query. For "components": component name or category. For "tokens": token name or category.'
      },
      domain: {
        type: 'string',
        enum: ['layout', 'typography', 'spacing', 'color', 'responsive', 'components', 'styles', 'effects', 'interaction', 'patterns'],
        description: 'Optional domain filter for "knowledge" source.'
      },
      category: {
        type: 'string',
        description: 'Optional category filter for "components" source.'
      }
    },
    required: ['source']
  },
  executionStrategy: 'parallel',
  errors: {
    'INVALID_SOURCE': 'Source must be one of: knowledge, components, tokens.',
    'NO_RESULTS': 'No results found for the given query.'
  }
};
