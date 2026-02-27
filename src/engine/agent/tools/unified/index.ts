/**
 * @file unified/index.ts
 * @description Barrel export for all unified tool definitions.
 * These 7 tools replace the previous 21 specialized tools.
 */

export { readNodeDefinition } from './readNode';
export { createNodeDefinition as unifiedCreateNodeDefinition } from './createNode';
export { patchNodeDefinition as unifiedPatchNodeDefinition } from './patchNode';
export { deleteNodeDefinition as unifiedDeleteNodeDefinition } from './deleteNode';
export { queryKnowledgeDefinition } from './queryKnowledge';
export { validateDesignDefinition } from './validateDesign';
export { signalDefinition } from './signal';

import { readNodeDefinition } from './readNode';
import { createNodeDefinition } from './createNode';
import { patchNodeDefinition } from './patchNode';
import { deleteNodeDefinition } from './deleteNode';
import { queryKnowledgeDefinition } from './queryKnowledge';
import { validateDesignDefinition } from './validateDesign';
import { signalDefinition } from './signal';

import { ToolDefinition } from '../types';

/**
 * All 7 unified tool definitions.
 * Drop-in replacement for the old agentTools array.
 */
export const unifiedTools: ToolDefinition[] = [
  signalDefinition,             // Flow control (plan/task/progress/complete)
  readNodeDefinition,           // Read anything from Figma
  createNodeDefinition,         // Create nodes
  patchNodeDefinition,          // Modify existing nodes
  deleteNodeDefinition,         // Delete nodes
  queryKnowledgeDefinition,     // Query knowledge/components/tokens
  validateDesignDefinition,     // Validate designs
];
