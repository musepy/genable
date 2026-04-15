/**
 * @file index.ts
 * @description Consolidated entry point for all Agentic Tools.
 *
 * 9 first-class tools — all structured JSON, no CLI parsing layer.
 */

import { unifiedTools } from './unified';
import { ToolDefinition } from './types';

/**
 * Primary tool set for LLM function calling.
 */
export const agentTools: ToolDefinition[] = unifiedTools;

/**
 * All tool definitions — used for auto-deriving runtime sets.
 */
export const allToolDefinitions: ToolDefinition[] = unifiedTools;

// Re-export types and utilities
export * from './types';
export { unifiedTools } from './unified';
