/**
 * @file index.ts
 * @description Consolidated entry point for all Agentic Tools.
 *
 * LLM sees a single `run` tool. Internally, commands are dispatched to
 * individual command definitions (context, outline, inspect, design, replace, query).
 *
 * toolDisplayMap and allToolDefinitions are indexed by command name (not 'run')
 * so that downstream code (events, cleaning, idempotency) works transparently.
 */

// ── Unified Tools ──
import { unifiedTools, getAllCommandDefinitions } from './unified';
import { ToolDefinition, ToolDisplayMeta } from './types';

/**
 * Primary tool set for LLM function calling.
 * Contains only the `run` tool — the single LLM-facing entry point.
 */
export const agentTools: ToolDefinition[] = unifiedTools;

/**
 * Static lookup: command name → display metadata.
 * Built from individual command definitions (not the `run` wrapper).
 */
export const toolDisplayMap: Record<string, ToolDisplayMeta> = Object.fromEntries(
  getAllCommandDefinitions()
    .filter(t => t.display)
    .map(t => [t.name, t.display!])
);

/**
 * All command definitions — used for auto-deriving runtime sets
 * (e.g., idempotent tools, tool result cleaning).
 * These are the individual commands, not the `run` wrapper.
 */
export const allToolDefinitions: ToolDefinition[] = getAllCommandDefinitions();

// Re-export types and utilities
export * from './types';
export { unifiedTools } from './unified';
