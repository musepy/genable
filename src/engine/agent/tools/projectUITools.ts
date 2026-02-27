/**
 * @file projectUITools.ts
 * @description Tools for querying project UI components as LLM context.
 *
 * These tools allow the LLM to understand and reference the project's
 * existing UI components when generating Figma designs, ensuring
 * consistency with the established design system.
 */

import { ToolDefinition, ToolExecutor, ToolResponse } from './types';
import {
  PROJECT_UI_REGISTRY,
  PROJECT_DESIGN_TOKENS,
  getComponent,
  searchComponents,
  getComponentsByCategory,
  getComponentNames,
  UIComponentMeta,
} from '../../../knowledge/projectUIRegistry';

// ==========================================
// 1. getProjectUIContext Tool
// ==========================================

export const getProjectUIContextDefinition: ToolDefinition = {
  name: 'getProjectUIContext',
  category: 'knowledge',
  dependencies: [],
  description: 'Retrieve a REFERENCE technical specification for project UI components. Use ONLY when user explicitly requests project-specific implementations. For free design or generic systems (iOS, shadcn), rely on your own knowledge.',
  parameters: {
    type: 'object',
    properties: {
      component: {
        type: 'string',
        description: 'Specific component name to get details for (e.g., "Button", "Card", "Header"). Case-insensitive.',
      },
      category: {
        type: 'string',
        description: 'Filter components by category.',
        enum: ['layout', 'input', 'display', 'feedback', 'navigation'],
      },
      query: {
        type: 'string',
        description: 'Search query to find relevant components by name or description.',
      },
      includeTokens: {
        type: 'boolean',
        description: 'Include design tokens (colors, spacing, typography) in the response. Useful for understanding the design system.',
      },
    },
  },
  executionStrategy: 'parallel',
};

interface GetProjectUIContextParams {
  component?: string;
  category?: 'layout' | 'input' | 'display' | 'feedback' | 'navigation';
  query?: string;
  includeTokens?: boolean;
}

import { knowledgeHub } from '../../llm-client/knowledge/knowledgeHub';

export const getProjectUIContext: ToolExecutor<GetProjectUIContextParams> = async (params) => {
  try {
    const { component, category, query, includeTokens } = params;
    const result: any = {};

    // Get specific component
    if (component) {
      const comp = getComponent(component);
      if (comp) {
        // Enrich with design anatomy from KnowledgeHub
        const enriched = knowledgeHub.getEnrichedComponent(comp);
        result.component = formatComponentForLLM(enriched as any);
      } else {
        // Suggest similar components
        const similar = searchComponents(component);
        result.component = null;
        result.suggestions = similar.slice(0, 3).map(c => c.name);
        result.message = `Component "${component}" not found. Did you mean: ${result.suggestions.join(', ')}?`;
      }
    }

    // Get components by category
    if (category) {
      const categoryComponents = getComponentsByCategory(category);
      result.categoryComponents = categoryComponents.map(c => ({
        name: c.name,
        description: c.description,
        path: c.path,
      }));
    }

    // Search components
    if (query) {
      const searchResults = searchComponents(query);
      result.searchResults = searchResults.map(c => ({
        name: c.name,
        description: c.description,
        category: c.category,
      }));
    }

    // Include design tokens
    if (includeTokens) {
      result.designTokens = PROJECT_DESIGN_TOKENS;
    }

    // If no specific query, return overview
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
      error: { code: 'PROJECT_UI_ERROR', message: err.message },
    };
  }
};

/**
 * Format component metadata for LLM consumption
 */
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

// ==========================================
// 2. getDesignSystemTokens Tool
// ==========================================

export const getDesignSystemTokensDefinition: ToolDefinition = {
  name: 'getDesignSystemTokens',
  category: 'knowledge',
  dependencies: [],
  description: 'Retrieve the project\'s design tokens (colors, spacing, typography, radius). Use these values to ensure generated designs match the project\'s visual language.',
  parameters: {
    type: 'object',
    properties: {
      tokenType: {
        type: 'string',
        description: 'Specific token category to retrieve.',
        enum: ['colors', 'spacing', 'typography', 'radius', 'all'],
      },
    },
  },
  executionStrategy: 'parallel',
};

interface GetDesignSystemTokensParams {
  tokenType?: 'colors' | 'spacing' | 'typography' | 'radius' | 'all';
}

export const getDesignSystemTokens: ToolExecutor<GetDesignSystemTokensParams> = async (params) => {
  try {
    const { tokenType = 'all' } = params;

    if (tokenType === 'all') {
      return {
        success: true,
        data: PROJECT_DESIGN_TOKENS,
      };
    }

    const tokens = PROJECT_DESIGN_TOKENS[tokenType];
    if (!tokens) {
      return {
        success: false,
        error: { code: 'INVALID_TOKEN_TYPE', message: `Token type "${tokenType}" not found.` },
      };
    }

    return {
      success: true,
      data: { [tokenType]: tokens },
    };
  } catch (err: any) {
    return {
      success: false,
      error: { code: 'TOKEN_ERROR', message: err.message },
    };
  }
};

// ==========================================
// 3. listProjectComponents Tool
// ==========================================

export const listProjectComponentsDefinition: ToolDefinition = {
  name: 'listProjectComponents',
  category: 'knowledge',
  dependencies: [],
  description: 'List all available UI components in the project with brief descriptions. Use this to discover what components exist before creating designs.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by component category.',
        enum: ['layout', 'input', 'display', 'feedback', 'navigation'],
      },
    },
  },
  executionStrategy: 'parallel',
};

interface ListProjectComponentsParams {
  category?: 'layout' | 'input' | 'display' | 'feedback' | 'navigation';
}

export const listProjectComponents: ToolExecutor<ListProjectComponentsParams> = async (params) => {
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
      error: { code: 'LIST_ERROR', message: err.message },
    };
  }
};

// ==========================================
// Export all tools
// ==========================================

export const projectUITools = {
  definitions: [
    getProjectUIContextDefinition,
    getDesignSystemTokensDefinition,
    listProjectComponentsDefinition,
  ],
  executors: {
    getProjectUIContext,
    getDesignSystemTokens,
    listProjectComponents,
  },
};
