import { ToolDefinition } from '../types';

// ── Single source of truth: query sources ──
export const QUERY_SOURCES = ['knowledge', 'nodes'] as const;
export type QuerySource = (typeof QUERY_SOURCES)[number];

/**
 * Unified query tool — searches knowledge base (design patterns + skills) or canvas nodes.
 * Replaces query_knowledge: merged knowledge+skill into unified BM25 search, added nodes search.
 */
export const queryDefinition: ToolDefinition = {
  name: 'query',
  category: 'knowledge',
  display: { displayName: 'Query', group: 'inspect' },
  description: `Search for design knowledge or canvas nodes.

Sources:
- "knowledge": Search design patterns, spacing rules, typography, layout conventions, and skill instructions. Uses fuzzy text search.
- "nodes": Search the current Figma page for nodes by name or type. Returns matching node IDs, names, types, and positions.`,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: [...QUERY_SOURCES],
        description: 'What to search: "knowledge" for design patterns and skills, "nodes" for canvas elements.'
      },
      query: {
        type: 'string',
        description: 'Search query. For "knowledge": natural language (e.g. "card spacing"). For "nodes": node name substring or type (e.g. "login button", "TEXT").'
      },
    },
    required: ['source', 'query']
  },
  executionStrategy: 'parallel',
  errors: {
    INVALID_SOURCE: `Source must be one of: ${QUERY_SOURCES.join(', ')}.`,
    SEARCH_ERROR: 'An error occurred while searching.',
    NO_RESULTS: 'No matching results found.',
  },
};
