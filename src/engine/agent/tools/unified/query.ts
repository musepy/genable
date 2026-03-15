import { ToolDefinition } from '../types';

// ── Single source of truth: query sources ──
export const QUERY_SOURCES = ['nodes', 'guidelines', 'style-tags', 'style', 'help'] as const;
export type QuerySource = (typeof QUERY_SOURCES)[number];

/**
 * Unified query tool — searches knowledge base (design patterns + skills) or canvas nodes.
 * Replaces query_knowledge: merged knowledge+skill into unified BM25 search, added nodes search.
 */
export const queryDefinition: ToolDefinition = {
  name: 'query',
  category: 'knowledge',
  display: { displayName: 'Query', group: 'inspect' },
  description: `Search canvas nodes, get design guidelines, retrieve visual style guides, or get detailed help documentation.

Sources:
- "nodes": Search the current Figma page for nodes by name or type. Returns matching node IDs, names, types, and positions.
- "guidelines": Get a complete design guideline document for a topic. Returns XML skeletons, layout templates, and anti-patterns. Topics: dashboard, form, landing-page, card-layout, navigation, mobile, table, chart. Pass the topic name as the query.
- "style-tags": List all available visual style tags. Use when you want to explore or narrow a visual direction for a new design. No query needed.
- "style": Get a complete visual style guide (colors, typography, spacing, shape). Pass comma-separated tags as query (e.g. "dark-mode, dashboard, blue-accent"). Returns the best-matching style guide.
- "help": Get detailed usage documentation for a tool or workflow topic. Pass a topic slug (e.g. "components", "variants", "progressive-creation") or a natural language query (e.g. "how to create reusable elements"). Returns comprehensive guides with syntax, rules, and examples. Use when you need detailed guidance before a complex workflow. Omit query to list all available topics.`,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: [...QUERY_SOURCES],
        description: 'What to search: "nodes" for canvas elements, "guidelines" for design handbooks, "style-tags" for available style tags, "style" for a visual style guide, "help" for tool/workflow documentation.'
      },
      query: {
        type: 'string',
        description: 'Search query. For "nodes": node name substring or type. For "guidelines": topic name (e.g. "dashboard"). For "style": comma-separated tags (e.g. "dark-mode, minimal, dashboard"). For "style-tags": ignored (returns all tags). For "help": topic slug (e.g. "components") or natural language query; omit to list all topics.'
      },
    },
    required: ['source']
  },
  executionStrategy: 'parallel',
  errors: {
    INVALID_SOURCE: `Source must be one of: ${QUERY_SOURCES.join(', ')}.`,
    SEARCH_ERROR: 'An error occurred while searching.',
    NO_RESULTS: 'No matching results found.',
    UNKNOWN_TOPIC: 'Unknown guideline topic. Available: dashboard, form, landing-page, card-layout, navigation, mobile, table, chart.',
    NO_STYLE_MATCH: 'No style guide matched the given tags. Use query(source="style-tags") to see available tags.',
  },
};
