/**
 * @file index.ts
 * @description Consolidated entry point for all Agentic Tools.
 */

import {
  searchDesignKnowledgeDefinition,
  getComponentAnatomyDefinition,
  getFigmaLayoutRulesDefinition
} from './knowledgeTools';

import { projectUITools } from './projectUITools';

import { 
  planDesignDefinition,
  createNodeDefinition,
  setNodeLayoutDefinition,
  setNodeStylesDefinition,
  createIconDefinition,
  updateNodePropertiesDefinition,
  deleteNodeDefinition
} from './rendererTools';

import { inspectDesignDefinition } from './inspectTool';

import { validateLayoutDefinition } from './validationTools';

import { applyDesignPatchDefinition, batchOperationsDefinition } from './designSuperTools';

import { generateDesignDefinition } from './generateDesignTool';

import { 
  renderSubtreeDefinition, 
  patchNodeDefinition 
} from './stateTools';

import { workflowTools } from './workflowTools';

/**
 * All tool definitions for LLM function calling.
 * TOTAL: ~13 tools (reduced from 17+).
 */
export const agentTools = [
  ...workflowTools,             // new_task, update_todo_list, summarize_progress, complete_task
  ...projectUITools.definitions,
  inspectDesignDefinition,      // [NEW] Replaces getSelection, getDeepHierarchy, getNodeDSL
  generateDesignDefinition,     // One-shot full component tree
  renderSubtreeDefinition,      // [NEW] High-level state-driven render (Flat List)
  patchNodeDefinition,          // [NEW] High-level state-driven patch (Props-Only)
  batchOperationsDefinition,    // Batch create/modify
  applyDesignPatchDefinition,   // Batch modify
  planDesignDefinition,         // Planning
  searchDesignKnowledgeDefinition,
  getComponentAnatomyDefinition,
  getFigmaLayoutRulesDefinition,
  createNodeDefinition,         // Create
  setNodeLayoutDefinition,      // Layout
  setNodeStylesDefinition,      // Styles
  createIconDefinition,         // Icons
  updateNodePropertiesDefinition,
  deleteNodeDefinition,
  validateLayoutDefinition
];

/**
 * Plan/Act Tool Filtering
 * 
 * PLANNING mode: Only planning + read + knowledge tools
 * EXECUTION mode: Only execution tools (no planDesign)
 * RECOVERY mode: Read/diagnose first, then finalize or resume
 * VERIFICATION mode: Only read + validate + complete_task
 */
const PLANNING_TOOLS = [
  'planDesign',
  'inspectDesign',
  'searchDesignKnowledge',
  'getComponentAnatomy',
  'getFigmaLayoutRules',
  'new_task',
  'update_todo_list',
  ...projectUITools.definitions.map(t => t.name)
];

const EXECUTION_TOOLS = [
  'inspectDesign',
  'generateDesign',
  'renderSubtree',
  'patchNode',
  'batchOperations',
  'createNode',
  'setNodeLayout',
  'setNodeStyles',
  'createIcon',
  'updateNodeProperties',
  'deleteNode',
  'applyDesignPatch',
  'update_todo_list',
  'summarize_progress',
  'complete_task'
];

const VERIFICATION_TOOLS = [
  'inspectDesign',
  'validateLayout',
  'summarize_progress',
  'complete_task'
];

const RECOVERY_TOOLS = [
  'inspectDesign',
  'validateLayout',
  'update_todo_list',
  'summarize_progress',
  'complete_task'
];

/**
 * Filter tools based on agent mode.
 * Returns only tools appropriate for the current phase.
 */
export function getToolsForMode(mode: 'PLANNING' | 'EXECUTION' | 'RECOVERY' | 'VERIFICATION', allTools: typeof agentTools): typeof agentTools {
  let allowedNames: string[];
  
  switch (mode) {
    case 'PLANNING':
      allowedNames = PLANNING_TOOLS;
      break;
    case 'EXECUTION':
      allowedNames = EXECUTION_TOOLS;
      break;
    case 'VERIFICATION':
      allowedNames = VERIFICATION_TOOLS;
      break;
    case 'RECOVERY':
      allowedNames = RECOVERY_TOOLS;
      break;
    default:
      return allTools;
  }
  
  return allTools.filter(tool => allowedNames.includes(tool.name));
}

// Re-export types
export * from './types';
