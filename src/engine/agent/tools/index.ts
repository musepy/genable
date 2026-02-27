/**
 * @file index.ts
 * @description Consolidated entry point for all Agentic Tools.
 * 
 * [ARCHITECTURE] Two tool sets are exported:
 * - `agentTools` (default): 7 unified primitives — used by the LLM.
 * - `legacyAgentTools`: Original 21 tools — kept for backward compatibility in routing.
 */

// ── Unified Tools (7 primitives) ──
import { unifiedTools } from './unified';

// ── Legacy Tools (for backward compat routing) ──
import {
  searchDesignKnowledgeDefinition
} from './knowledgeTools';

import { projectUITools } from './projectUITools';

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
import { ToolValidator } from './toolValidator';
import { ToolDefinition } from './types';

/**
 * Primary tool set for LLM function calling.
 * 7 unified primitives: read_node, create_node, patch_node, delete_node, query_knowledge, validate_design, signal.
 */
export const agentTools: ToolDefinition[] = unifiedTools;

/**
 * Legacy tool definitions — kept for backward compatibility.
 * The toolCallHandler still routes old tool names to their implementations.
 */
export const legacyAgentTools: ToolDefinition[] = [
  ...workflowTools,
  ...projectUITools.definitions,
  inspectDesignDefinition,
  generateDesignDefinition,
  renderSubtreeDefinition,
  patchNodeDefinition,
  batchOperationsDefinition,
  applyDesignPatchDefinition,
  searchDesignKnowledgeDefinition,
  createNodeDefinition,
  setNodeLayoutDefinition,
  setNodeStylesDefinition,
  createIconDefinition,
  updateNodePropertiesDefinition,
  deleteNodeDefinition,
  validateLayoutDefinition
];

// Re-export types and utilities
export * from './types';
export { ToolValidator } from './toolValidator';
export { unifiedTools } from './unified';
