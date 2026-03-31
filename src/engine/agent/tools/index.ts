/**
 * @file index.ts
 * @description Consolidated entry point for all Agentic Tools.
 *
 * 9 first-class tools — all structured JSON, no CLI parsing layer.
 * toolDisplayMap indexed by tool name for downstream code (events, cleaning).
 */

import { unifiedTools } from './unified';
import { ToolDefinition, ToolDisplayMeta } from './types';

/**
 * Primary tool set for LLM function calling.
 */
export const agentTools: ToolDefinition[] = unifiedTools;

/**
 * Static lookup: tool name → display metadata.
 */
export const toolDisplayMap: Record<string, ToolDisplayMeta> = Object.fromEntries(
  unifiedTools
    .filter(t => t.display)
    .map(t => [t.name, t.display!])
);

/**
 * All tool definitions — used for auto-deriving runtime sets.
 */
export const allToolDefinitions: ToolDefinition[] = unifiedTools;

// Re-export types and utilities
export * from './types';
export { unifiedTools } from './unified';
