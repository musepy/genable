/**
 * @file knowledgeTools.ts
 * @description Knowledge-related tools for the Agent.
 */

import { knowledgeHub } from '../../llm-client/knowledge/knowledgeHub';
import { ToolDefinition, ToolExecutor, ToolResponse } from './types';

// ==========================================
// 1. searchDesignKnowledge Tool
// ==========================================

export const searchDesignKnowledgeDefinition: ToolDefinition = {
  name: 'searchDesignKnowledge',
  category: 'knowledge',
  modes: ['PLANNING'],
  dependencies: [],
  description: 'Search for UI/UX design knowledge, aesthetic directions, visual inspiration, style priorities, color palettes, or industry-specific patterns.',
  parameters: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'The specific knowledge domain to search within.',
        enum: ['reasoning', 'styles', 'colors', 'typography', 'landing', 'charts', 'products', 'guidelines', 'stacks', 'figmaLayout']
      },
      query: {
        type: 'string',
        description: 'The search query or keyword.'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default 3).'
      }
    },
    required: ['domain', 'query']
  },
  executionStrategy: 'parallel'
};

export const searchDesignKnowledge: ToolExecutor<{
  domain: 'reasoning' | 'styles' | 'colors' | 'typography' | 'landing' | 'charts' | 'products' | 'guidelines' | 'stacks' | 'figmaLayout';
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
        // Note: stacks retrieval usually requires a specific stack name, we'll search across all if not specified
        results = knowledgeHub.searchStackRules('', query, limit);
        break;
      case 'figmaLayout':
        results = knowledgeHub.searchFigmaLayout(query, limit);
        break;
      default:
        return {
          success: false,
          error: { code: 'INVALID_DOMAIN', message: `Domain '${domain}' is not recognized.` }
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
      error: { code: 'SEARCH_ERROR', message: err.message }
    };
  }
};

// ==========================================
// 2. getComponentAnatomy Tool
// ==========================================

export const getComponentAnatomyDefinition: ToolDefinition = {
  name: 'getComponentAnatomy',
  category: 'knowledge',
  modes: ['PLANNING'],
  dependencies: [],
  description: 'Retrieve a REFERENCE structural blueprint for a specific UI component. Use ONLY when user explicitly requests project/system patterns. For custom or relative adjustments, rely on your own design reasoning.',
  parameters: {
    type: 'object',
    properties: {
      componentName: {
        type: 'string',
        description: 'The semantic name of the component (e.g., "button", "card", "badge").'
      }
    },
    required: ['componentName']
  },
  executionStrategy: 'parallel'
};

export const getComponentAnatomy: ToolExecutor<{
  componentName: string;
}> = async ({ componentName }) => {
  try {
    // Attempt semantic search first
    const results = knowledgeHub.searchAnatomy(componentName, 1);
    
    if (results.length > 0 && results[0].score > 0.4) {
      const blueprint = results[0].item;
      return {
        success: true,
        data: {
          found: true,
          blueprint: {
            id: blueprint.id,
            name: blueprint.name,
            structure: blueprint.structure,
            defaultProps: blueprint.defaultProps,
            variants: blueprint.variants
          }
        }
      };
    }

    // Direct key fallback
    const directResult = knowledgeHub.getAnatomyByKey(componentName);
    if (directResult) {
       return {
        success: true,
        data: {
          found: true,
          blueprint: {
            id: componentName.toLowerCase(),
            name: componentName,
            structure: directResult.structure,
            defaultProps: directResult.defaultProps,
            variants: directResult.variants
          }
        }
      };
    }

    return {
      success: true,
      data: { found: false }
    };
  } catch (err: any) {
    return {
      success: false,
      error: { code: 'ANATOMY_ERROR', message: err.message }
    };
  }
};

// ==========================================
// 3. getFigmaLayoutRules Tool
// ==========================================

export const getFigmaLayoutRulesDefinition: ToolDefinition = {
  name: 'getFigmaLayoutRules',
  category: 'knowledge',
  modes: ['PLANNING'],
  dependencies: [],
  description: 'Retrieve specific Figma layout constraints and rules (Do/Don\'t) to ensure design system compliance.',
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Specific topic to filter rules (e.g., "auto layout", "sizing").'
      },
      severityFilter: {
        type: 'string',
        description: 'Filter rules by severity level.',
        enum: ['Critical', 'High', 'Medium', 'Low']
      }
    }
  },
  executionStrategy: 'parallel'
};

export const getFigmaLayoutRules: ToolExecutor<{
  topic?: string;
  severityFilter?: 'Critical' | 'High' | 'Medium' | 'Low';
}> = async ({ topic, severityFilter }) => {
  try {
    let rules = topic 
      ? knowledgeHub.searchFigmaLayout(topic, 10).map(r => r.item)
      : knowledgeHub.getAllFigmaLayoutRules();

    if (severityFilter) {
      rules = rules.filter(r => r.severity === severityFilter);
    }

    return {
      success: true,
      data: {
        rules: rules.map(r => ({
          id: r.id,
          issue: r.issue,
          description: r.description,
          do: r.do,
          dont: r.dont,
          severity: r.severity
        }))
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: { code: 'RULES_ERROR', message: err.message }
    };
  }
};
