/**
 * @file unified/index.ts
 * @description Barrel export for all unified tool definitions.
 * These 8 tools replace the previous 21 specialized tools.
 */

export { readNodeDefinition } from './readNode';
export { buildDesignDefinition as unifiedBuildDesignDefinition } from '../buildDesignTool';
export { patchNodeDefinition as unifiedPatchNodeDefinition } from './patchNode';
export { deleteNodeDefinition as unifiedDeleteNodeDefinition } from './deleteNode';
export { queryKnowledgeDefinition } from './queryKnowledge';
export { validateDesignDefinition } from './validateDesign';
export { captureScreenshotDefinition } from './captureScreenshot';
export { signalDefinition } from './signal';

import { readNodeDefinition } from './readNode';
import { buildDesignDefinition } from '../buildDesignTool';
import { patchNodeDefinition } from './patchNode';
import { deleteNodeDefinition } from './deleteNode';
import { queryKnowledgeDefinition } from './queryKnowledge';
import { validateDesignDefinition } from './validateDesign';
import { captureScreenshotDefinition } from './captureScreenshot';
import { signalDefinition } from './signal';

import { ToolDefinition } from '../types';

/**
 * All 8 unified tool definitions.
 * Drop-in replacement for the old agentTools array.
 */
export const unifiedTools: ToolDefinition[] = [
  signalDefinition,             // Flow control (plan/task/progress/complete)
  readNodeDefinition,           // Read anything from Figma
  buildDesignDefinition,        // Create designs via DSL instructions
  patchNodeDefinition,          // Modify existing nodes
  deleteNodeDefinition,         // Delete nodes
  queryKnowledgeDefinition,     // Query knowledge/components/tokens
  validateDesignDefinition,     // Validate designs
  captureScreenshotDefinition,  // Visual screenshot capture
];
