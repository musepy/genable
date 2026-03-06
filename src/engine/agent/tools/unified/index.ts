/**
 * @file unified/index.ts
 * @description Barrel export for all unified tool definitions.
 * These 4 tools are the complete LLM-facing API:
 *   read | create | edit | query
 */

export { readNodeDefinition } from './readNode';
export { createDefinition } from '../createTool';
export { editDefinition } from './edit';
export { queryDefinition } from './query';

import { readNodeDefinition } from './readNode';
import { createDefinition } from '../createTool';
import { editDefinition } from './edit';
import { queryDefinition } from './query';

import { ToolDefinition } from '../types';

/**
 * All 4 unified tool definitions.
 */
export const unifiedTools: ToolDefinition[] = [
  readNodeDefinition,           // Read anything from Figma
  createDefinition,             // Create designs via XML markup
  editDefinition,               // Modify/delete existing nodes via XML
  queryDefinition,              // Search knowledge or canvas nodes
];
