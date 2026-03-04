/**
 * @file unified/index.ts
 * @description Barrel export for all unified tool definitions.
 * These 4 tools are the complete LLM-facing API:
 *   read | create | edit | query_knowledge
 */

export { readNodeDefinition } from './readNode';
export { buildDesignDefinition as unifiedBuildDesignDefinition } from '../buildDesignTool';
export { editDefinition } from './edit';
export { queryKnowledgeDefinition } from './queryKnowledge';

import { readNodeDefinition } from './readNode';
import { buildDesignDefinition } from '../buildDesignTool';
import { editDefinition } from './edit';
import { queryKnowledgeDefinition } from './queryKnowledge';

import { ToolDefinition } from '../types';

/**
 * All 4 unified tool definitions.
 * Drop-in replacement for the old agentTools array.
 */
export const unifiedTools: ToolDefinition[] = [
  readNodeDefinition,           // Read anything from Figma
  buildDesignDefinition,        // Create designs via XML markup
  editDefinition,               // Modify/delete existing nodes via XML
  queryKnowledgeDefinition,     // Query knowledge/components/tokens
];
