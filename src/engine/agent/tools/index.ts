/**
 * @file index.ts
 * @description Consolidated entry point for all Agentic Tools.
 *
 * Exports the 7 unified primitives used by the LLM:
 * signal | read_node | build_design | patch_node | delete_node | query_knowledge | validate_design
 */

// ── Unified Tools (7 primitives) ──
import { unifiedTools } from './unified';
import { ToolDefinition } from './types';

/**
 * Primary tool set for LLM function calling.
 * 7 unified primitives: read_node, build_design, patch_node, delete_node, query_knowledge, validate_design, signal.
 */
export const agentTools: ToolDefinition[] = unifiedTools;

// Re-export types and utilities
export * from './types';
export { unifiedTools } from './unified';
