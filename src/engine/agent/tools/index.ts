/**
 * @file index.ts
 * @description Consolidated entry point for all Agentic Tools.
 *
 * Exports the 4 unified primitives used by the LLM:
 * read | create | edit | query
 */

// ── Unified Tools (4 primitives) ──
import { unifiedTools } from './unified';
import { ToolDefinition, ToolDisplayMeta } from './types';

/**
 * Primary tool set for LLM function calling.
 * 4 unified primitives: read, create, edit, query.
 */
export const agentTools: ToolDefinition[] = unifiedTools;

/** Static lookup: tool name → display metadata. Built once from agentTools. */
export const toolDisplayMap: Record<string, ToolDisplayMeta> = Object.fromEntries(
  agentTools
    .filter(t => t.display)
    .map(t => [t.name, t.display!])
);

/** All tool definitions — used for auto-deriving runtime sets (e.g., idempotent tools). */
export const allToolDefinitions: ToolDefinition[] = agentTools;

// Re-export types and utilities
export * from './types';
export { unifiedTools } from './unified';
