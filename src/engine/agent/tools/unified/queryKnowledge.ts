import { ToolDefinition, ToolExecutor } from '../types';
import { knowledgeHub } from '../../../llm-client/knowledge/knowledgeHub';
import { PROJECT_DESIGN_TOKENS } from '../../../../knowledge/projectUIRegistry';

// ── Single source of truth: domain values ──
const KNOWLEDGE_DOMAINS = [
  'reasoning', 'styles', 'colors', 'typography',
  'landing', 'charts', 'products', 'guidelines',
  'stacks', 'figmaLayout',
] as const;

export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

// ── Single source of truth: error codes across all sub-executors ──
const QUERY_KNOWLEDGE_ERRORS = {
  INVALID_SOURCE: 'Source must be one of: knowledge, tokens, skill.',
  INVALID_DOMAIN: `Domain must be one of: ${KNOWLEDGE_DOMAINS.join(', ')}.`,
  SEARCH_ERROR: 'An error occurred while searching the knowledge base.',
  INVALID_TOKEN_TYPE: 'Token type not found in design system.',
  TOKEN_ERROR: 'An error occurred while querying design tokens.',
} as const;

export type QueryKnowledgeErrorCode = keyof typeof QUERY_KNOWLEDGE_ERRORS;

/**
 * Unified knowledge query — replaces searchDesignKnowledge and getDesignSystemTokens.
 */
export const queryKnowledgeDefinition: ToolDefinition = {
  name: 'query_knowledge',
  category: 'knowledge',
  display: { displayName: 'Query Knowledge', group: 'inspect' },
  description: `Query design knowledge or design tokens. This is the ONLY tool for accessing design reference information.

Sources:
- "knowledge": Search design patterns, spacing rules, typography conventions, and responsive guidelines.
- "tokens": Get design system tokens (colors, spacing, typography scales).
- "skill": Load detailed skill instructions by skill ID.`,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['knowledge', 'tokens', 'skill'],
        description: 'What to query: "knowledge" for design patterns, "tokens" for design tokens, "skill" for detailed skill instructions.'
      },
      query: {
        type: 'string',
        description: 'Search query or filter. For "knowledge": natural language query. For "tokens": token name or category. For "skill": the skill ID to load.'
      },
      domain: {
        type: 'string',
        enum: [...KNOWLEDGE_DOMAINS],
        description: 'Optional domain filter for "knowledge" source.'
      },
    },
    required: ['source']
  },
  executionStrategy: 'parallel',
  errors: { ...QUERY_KNOWLEDGE_ERRORS },
};

// ── Executor: searchDesignKnowledge ──

export const searchDesignKnowledgeExecutor: ToolExecutor<{
  domain: KnowledgeDomain;
  query: string;
  limit?: number;
}> = async ({ domain, query, limit = 3 }) => {
  try {
    let results: any[] = [];

    switch (domain) {
      case 'reasoning':
        results = knowledgeHub.searchReasoning(query, limit);
        break;
      case 'styles':
        results = knowledgeHub.searchStyles(query, limit);
        break;
      case 'colors':
        results = knowledgeHub.searchColors(query, limit);
        break;
      case 'typography':
        results = knowledgeHub.searchTypography(query, limit);
        break;
      case 'landing':
        results = knowledgeHub.searchLanding(query, limit);
        break;
      case 'charts':
        results = knowledgeHub.searchCharts(query, limit);
        break;
      case 'products':
        results = knowledgeHub.searchProducts(query, limit);
        break;
      case 'guidelines':
        results = knowledgeHub.searchGuidelines(query, limit);
        break;
      case 'stacks':
        results = knowledgeHub.searchStackRules('', query, limit);
        break;
      case 'figmaLayout':
        results = knowledgeHub.searchFigmaLayout(query, limit);
        break;
      default:
        return {
          success: false,
          error: { code: 'INVALID_DOMAIN' satisfies QueryKnowledgeErrorCode, message: `Domain '${domain}' is not recognized. Valid: ${KNOWLEDGE_DOMAINS.join(', ')}` }
        };
    }

    return {
      success: true,
      data: {
        results: results.map(r => r.item),
        totalAvailable: results.length
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: { code: 'SEARCH_ERROR' satisfies QueryKnowledgeErrorCode, message: err.message }
    };
  }
};

// ── Executor: getDesignSystemTokens ──

export const getDesignSystemTokensExecutor: ToolExecutor<{
  tokenType?: 'colors' | 'spacing' | 'typography' | 'radius' | 'all';
}> = async (params) => {
  try {
    const { tokenType = 'all' } = params;

    if (tokenType === 'all') {
      return { success: true, data: PROJECT_DESIGN_TOKENS };
    }

    const tokens = PROJECT_DESIGN_TOKENS[tokenType];
    if (!tokens) {
      return {
        success: false,
        error: { code: 'INVALID_TOKEN_TYPE' satisfies QueryKnowledgeErrorCode, message: `Token type "${tokenType}" not found.` },
      };
    }

    return { success: true, data: { [tokenType]: tokens } };
  } catch (err: any) {
    return {
      success: false,
      error: { code: 'TOKEN_ERROR' satisfies QueryKnowledgeErrorCode, message: err.message },
    };
  }
};
