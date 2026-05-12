/**
 * @file toolSearchTool.ts
 * @description `tool_search` — pull the full description + parameter schema
 * for a menu-listed (low-frequency) tool into recent context.
 *
 * The static system prompt renders low-frequency tools as `name: one-liner`
 * (see toolCategories.ts + serializeToolsCategorized). The provider's tools
 * API still carries the full spec for every tool, so the model can call any
 * tool directly. tool_search is the on-demand way to recall details when
 * the menu summary isn't enough — useful after long conversations where the
 * prefix info has aged out of effective attention.
 */

import type { ToolDefinition } from '../types';

export const toolSearchDefinition: ToolDefinition = {
  name: 'tool_search',
  executionStrategy: 'parallel',
  description: `Look up the full description and parameter schema for menu-listed (low-frequency) tools.

When to call:
  - You see a menu tool whose one-liner isn't enough to call it confidently.
  - You need to recall the exact parameter shape or examples for a tool you used many turns ago.
  - You're choosing between several similar-sounding menu tools.

You do NOT need to call this before every tool — high-frequency tools have full descriptions in this prompt, and the provider's tools spec carries the schema for every tool. Use tool_search as a refresher, not a gate.

Parameters:
  tool_names — array of 1–5 tool names to look up (exact names, no quotes inside).

Returns:
  {tools: [{name, description, input_schema}]} — one entry per requested tool. Unknown names come back with {name, error}.

Examples:
  tool_search({tool_names: ["clone_node"]})
  tool_search({tool_names: ["set_layout", "bind_variable", "ensure_variable"]})`,
  parameters: {
    type: 'object',
    properties: {
      tool_names: {
        type: 'array',
        description: 'Tool names to look up (1–5).',
        items: {
          type: 'string',
          description: 'Exact tool name as listed in the menu.',
        },
        maxItems: 5,
      },
    },
    required: ['tool_names'],
  },
};

/**
 * Build the executor closure. Caller supplies the live tools list — typically
 * `options.tools` from AgentRuntime so the lookup matches exactly what was
 * registered for this session.
 */
export function createToolSearchExecutor(tools: ToolDefinition[]) {
  const byName = new Map(tools.map(t => [t.name, t]));
  return async (args: any) => {
    const rawNames = args?.tool_names;
    if (!Array.isArray(rawNames) || rawNames.length === 0) {
      return { error: 'tool_search requires "tool_names" — array of 1-5 tool names.' };
    }
    if (rawNames.length > 5) {
      return { error: 'tool_search accepts at most 5 tool names per call.' };
    }
    const results = rawNames.map((raw: unknown) => {
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (!name) {
        return { name: String(raw), error: 'Empty tool name.' };
      }
      const tool = byName.get(name);
      if (!tool) {
        return { name, error: `Tool "${name}" not found.` };
      }
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      };
    });
    return { data: { tools: results } };
  };
}
