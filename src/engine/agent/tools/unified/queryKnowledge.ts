import { ToolDefinition, ToolExecutor } from '../types';
import { knowledgeHub } from '../../../llm-client/knowledge/knowledgeHub';
import {
  PROJECT_UI_REGISTRY,
  PROJECT_DESIGN_TOKENS,
  getComponent,
  searchComponents,
  getComponentsByCategory,
  getComponentNames,
  UIComponentMeta,
} from '../../../../knowledge/projectUIRegistry';

// ── Single source of truth: domain values ──
const KNOWLEDGE_DOMAINS = [
  'reasoning', 'styles', 'colors', 'typography',
  'landing', 'charts', 'products', 'guidelines',
  'stacks', 'figmaLayout',
] as const;

export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

// ── Single source of truth: error codes across all sub-executors ──
const QUERY_KNOWLEDGE_ERRORS = {
  INVALID_SOURCE: 'Source must be one of: knowledge, components, tokens, skill.',
  INVALID_DOMAIN: `Domain must be one of: ${KNOWLEDGE_DOMAINS.join(', ')}.`,
  SEARCH_ERROR: 'An error occurred while searching the knowledge base.',
  PROJECT_UI_ERROR: 'An error occurred while querying project UI context.',
  INVALID_TOKEN_TYPE: 'Token type not found in design system.',
  TOKEN_ERROR: 'An error occurred while querying design tokens.',
  LIST_ERROR: 'An error occurred while listing project components.',
} as const;

export type QueryKnowledgeErrorCode = keyof typeof QUERY_KNOWLEDGE_ERRORS;

/**
 * Unified knowledge query — replaces searchDesignKnowledge, getProjectUIContext, getDesignSystemTokens, listProjectComponents.
 */
export const queryKnowledgeDefinition: ToolDefinition = {
  name: 'query_knowledge',
  category: 'knowledge',
  display: { displayName: 'Query Knowledge', group: 'inspect' },
  description: `Query design knowledge, project components, or design tokens. This is the ONLY tool for accessing design reference information.

Sources:
- "knowledge": Search design patterns, spacing rules, typography conventions, and responsive guidelines.
- "components": Get project UI component specifications (names, categories, usage).
- "tokens": Get design system tokens (colors, spacing, typography scales).
- "skill": Load detailed skill instructions by skill ID.`,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['knowledge', 'components', 'tokens', 'skill'],
        description: 'What to query: "knowledge" for design patterns, "components" for UI components, "tokens" for design tokens, "skill" for detailed skill instructions.'
      },
      query: {
        type: 'string',
        description: 'Search query or filter. For "knowledge": natural language query. For "components": component name or category. For "tokens": token name or category. For "skill": the skill ID to load.'
      },
      domain: {
        type: 'string',
        enum: [...KNOWLEDGE_DOMAINS],
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

// ── Executor: getProjectUIContext ──

function formatComponentForLLM(comp: UIComponentMeta): any {
  return {
    name: comp.name,
    path: comp.path,
    description: comp.description,
    category: comp.category,
    props: comp.props.map(p => ({
      name: p.name,
      type: p.type,
      description: p.description,
      required: p.required || false,
      default: p.default,
      options: p.options,
    })),
    variants: comp.variants,
    figmaMapping: comp.figmaMapping,
    codeSnippet: comp.codeSnippet,
  };
}

export const getProjectUIContextExecutor: ToolExecutor<{
  component?: string;
  category?: 'layout' | 'input' | 'display' | 'feedback' | 'navigation';
  query?: string;
  includeTokens?: boolean;
}> = async (params) => {
  try {
    const { component, category, query, includeTokens } = params;
    const result: any = {};

    if (component) {
      const comp = getComponent(component);
      if (comp) {
        const enriched = knowledgeHub.getEnrichedComponent(comp);
        result.component = formatComponentForLLM(enriched as any);
      } else {
        const similar = searchComponents(component);
        result.component = null;
        result.suggestions = similar.slice(0, 3).map(c => c.name);
        result.message = `Component "${component}" not found. Did you mean: ${result.suggestions.join(', ')}?`;
      }
    }

    if (category) {
      const categoryComponents = getComponentsByCategory(category);
      result.categoryComponents = categoryComponents.map(c => ({
        name: c.name,
        description: c.description,
        path: c.path,
      }));
    }

    if (query) {
      const searchResults = searchComponents(query);
      result.searchResults = searchResults.map(c => ({
        name: c.name,
        description: c.description,
        category: c.category,
      }));
    }

    if (includeTokens) {
      result.designTokens = PROJECT_DESIGN_TOKENS;
    }

    if (!component && !category && !query) {
      result.availableComponents = getComponentNames();
      result.categories = ['layout', 'input', 'display', 'feedback', 'navigation'];
      result.hint = 'Specify a component name, category, or search query to get detailed information.';
    }

    return {
      success: true,
      data: result,
    };
  } catch (err: any) {
    return {
      success: false,
      error: { code: 'PROJECT_UI_ERROR' satisfies QueryKnowledgeErrorCode, message: err.message },
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

// ── Executor: listProjectComponents ──

export const listProjectComponentsExecutor: ToolExecutor<{
  category?: 'layout' | 'input' | 'display' | 'feedback' | 'navigation';
}> = async (params) => {
  try {
    const { category } = params;
    let components = Object.values(PROJECT_UI_REGISTRY);

    if (category) {
      components = components.filter(c => c.category === category);
    }

    return {
      success: true,
      data: {
        components: components.map(c => ({
          name: c.name,
          category: c.category,
          description: c.description,
        })),
        total: components.length,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: { code: 'LIST_ERROR' satisfies QueryKnowledgeErrorCode, message: err.message },
    };
  }
};

// ── Bundled executors (for useChat.ts) ──

export const projectUIExecutors = {
  getProjectUIContext: getProjectUIContextExecutor,
  getDesignSystemTokens: getDesignSystemTokensExecutor,
  listProjectComponents: listProjectComponentsExecutor,
};
