/**
 * @file index.ts
 * @description Consolidated entry point for all Agentic Tools.
 */

import { 
  searchDesignKnowledgeDefinition, 
  getComponentAnatomyDefinition, 
  getFigmaLayoutRulesDefinition 
} from './knowledgeTools';

import { 
  planDesignDefinition,
  createNodeDefinition,
  setNodeLayoutDefinition,
  setNodeStylesDefinition,
  createIconDefinition,
  updateNodePropertiesDefinition,
  deleteNodeDefinition
} from './rendererTools';

import { 
  getSelectionDefinition,
  getVariablesDefinition,
  getStylesDefinition,
  getNodeDSLDefinition
} from './readTools';

import { validateLayoutDefinition } from './validationTools';

import { 
  getDeepHierarchyDefinition,
  applyDesignPatchDefinition 
} from './designSuperTools';

import { workflowTools } from './workflowTools';

/**
 * All tool definitions for LLM function calling
 */
 export const agentTools = [
  ...workflowTools,
  getDeepHierarchyDefinition,
  applyDesignPatchDefinition,
  planDesignDefinition,
  searchDesignKnowledgeDefinition,
  getComponentAnatomyDefinition,
  getFigmaLayoutRulesDefinition,
  createNodeDefinition,
  setNodeLayoutDefinition,
  setNodeStylesDefinition,
  createIconDefinition,
  updateNodePropertiesDefinition,
  deleteNodeDefinition,
  validateLayoutDefinition,
  getSelectionDefinition,
  getVariablesDefinition,
  getStylesDefinition,
  getNodeDSLDefinition
];

// Re-export types
export * from './types';
