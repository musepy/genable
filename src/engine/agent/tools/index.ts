/**
 * @file index.ts
 * @description Consolidated entry point for all Agentic Tools.
 *
 * 9 first-class tools — all structured JSON, no CLI parsing layer.
 */

import { unifiedTools } from './unified';
import { ToolDefinition } from './types';
import type { LLMProviderCapabilities } from '../../llm-client/providers/types';

/**
 * Primary tool set for LLM function calling.
 */
export const agentTools: ToolDefinition[] = unifiedTools;

/**
 * All tool definitions — used for auto-deriving runtime sets.
 */
export const allToolDefinitions: ToolDefinition[] = unifiedTools;

/**
 * Tool names that produce image content (PNG/JPG attached as ImageBlock to
 * tool result). Filtered out when the active model has supportsVision=false,
 * so the LLM never tries to call them and never receives a result the model
 * would crash on. See shared/modelQuirks.ts for the per-model capability source.
 */
export const VISION_ONLY_TOOLS = new Set<string>(['get_screenshot']);

/**
 * Filter tool list by provider capabilities. Returns a subset that the
 * active model can actually use without crashing.
 *
 * Currently strips vision-only tools when supportsVision=false. Future:
 * add audio-only / file-only filters as new modalities ship.
 */
export function filterToolsByCapabilities(
  tools: ToolDefinition[],
  capabilities: LLMProviderCapabilities,
): ToolDefinition[] {
  if (capabilities.supportsVision) return tools;
  return tools.filter(t => !VISION_ONLY_TOOLS.has(t.name));
}

// Re-export types and utilities
export * from './types';
export { unifiedTools } from './unified';
