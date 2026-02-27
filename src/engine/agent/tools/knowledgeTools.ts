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
