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
  planDesignDefinition 
} from './planningTools';

import {
  createIconDefinition
} from './iconTools';

import {
  deleteNodeDefinition
} from './nodeTools';

import {
  createNodeDefinition,
  setNodeLayoutDefinition,
  setNodeStylesDefinition,
  updateNodePropertiesDefinition
} from './legacy/atomicTools';

import { inspectDesignDefinition } from './inspectTool';

import { validateLayoutDefinition } from './validationTools';

import { applyDesignPatchDefinition, batchOperationsDefinition } from './designSuperTools';

import { generateDesignDefinition } from './generateDesignTool';

import { 
  renderSubtreeDefinition, 
  patchNodeDefinition 
} from './stateTools';

import { workflowTools } from './workflowTools';
import { ToolDefinition, AgentMode } from './types';

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
  createNodeDefinition,         // Create (Legacy)
  setNodeLayoutDefinition,      // Layout (Legacy)
  setNodeStylesDefinition,      // Styles (Legacy)
  createIconDefinition,         // Icons
  updateNodePropertiesDefinition, // (Legacy)
  deleteNodeDefinition,
  validateLayoutDefinition
];

/**
 * Filter tools based on agent mode.
 * Each tool declares its own `modes` in its ToolDefinition.
 * If `modes` is omitted, the tool is available in all modes.
 */
export function getToolsForMode(mode: AgentMode, allTools: ToolDefinition[]): ToolDefinition[] {
  return allTools.filter(tool => !tool.modes || tool.modes.includes(mode));
}

// Re-export types
export * from './types';
