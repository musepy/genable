import { ToolDefinition } from '../types';

/**
 * Documentation and knowledge — like Unix man.
 * Replaces: query (guidelines, style-tags, style, help).
 */
export const manDefinition: ToolDefinition = {
  name: 'man',
  category: 'knowledge',
  display: { displayName: 'Manual', group: 'inspect' },
  executionStrategy: 'parallel',
  description: `Get design guidelines, style guides, and help documentation — like Unix man.

**Usage**:
  man                          → list all help topics
  man components               → help topic: components
  man variants                 → help topic: variant matrices
  man progressive-creation     → help topic: progressive creation
  man guidelines dashboard     → design guidelines for dashboards
  man guidelines form          → design guidelines for forms
  man style-tags               → list available visual style tags
  man style dark-mode,minimal  → get visual style guide by tags

**Guidelines topics**: dashboard, form, landing-page, card-layout, navigation, mobile, table, chart.
**Help topics**: components, variants, progressive-creation, modification, batch-replace, canvas-reading, parent-child, error-handling, style-guide, examples, error-catalog.`,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Knowledge source: guidelines, style-tags, style, help (default).',
      },
      query: {
        type: 'string',
        description: 'Topic or tags to look up.',
      },
    },
    required: [],
  },
  errors: {
    UNKNOWN_TOPIC: 'Unknown topic.',
    NO_STYLE_MATCH: 'No style guide matched the given tags.',
  },
};
