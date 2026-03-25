/**
 * @file toolResultCleaner.ts
 * @description Sanitizes tool calls for history context to prevent context bloat.
 *
 * Note: cleanToolResult() was removed — commands now own their output format,
 * and the presentation pipe (presentation.ts) handles LLM-facing guards.
 * Only sanitizeToolCallsForHistory() remains (context management concern).
 */

import { LLMToolCall } from '../../llm-client/providers/types';
import { ToolDefinition, ToolParameter } from '../tools/types';
import { CONTEXT_CONSTANTS } from './constants';

export class ToolResultCleaner {
  private toolMap: Map<string, ToolDefinition>;

  constructor(tools: ToolDefinition[]) {
    this.toolMap = new Map(tools.map(tool => [tool.name, tool]));
  }

  /**
   * Sanitizes tool calls for history to prevent context bloat.
   */
  public sanitizeToolCallsForHistory(toolCalls: LLMToolCall[]): LLMToolCall[] {
    return toolCalls.map(tc => {
      // Strip XML from edit history — tool result already has success/idMap feedback.
      if (tc.name === 'edit' && typeof tc.args?.xml === 'string' && tc.args.xml.length > 500) {
        return {
          ...tc,
          args: {
            ...(tc.args?.parentId && { parentId: tc.args.parentId }),
          }
        };
      }

      // Unwrap "run" tool — extract the actual command name from the CLI string
      const commandName = tc.name === 'run' && typeof tc.args?.command === 'string'
        ? tc.args.command.trim().split(/\s/)[0]
        : tc.name;

      const def = this.toolMap.get(commandName);
      if (!def) return tc;
      let sanitizedArgs = this.sanitizeArgsBySchema(tc.args, def.parameters as ToolParameter);

      const argsJson = JSON.stringify(sanitizedArgs);
      if (argsJson.length > CONTEXT_CONSTANTS.MAX_HISTORY_ARGS_CHARS) {
        sanitizedArgs = this.truncateArgs(tc.name, sanitizedArgs, argsJson.length);
      }

      return { ...tc, args: sanitizedArgs };
    });
  }

  private sanitizeString(value: any, maxLength = 200): string {
    const text = String(value ?? '');
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '…';
  }

  private sanitizeArgsBySchema(value: any, schema?: ToolParameter, depth = 0): any {
    if (value === null || value === undefined || !schema) return value;

    switch (schema.type) {
      case 'string':
        return this.sanitizeString(value);
      case 'number':
      case 'boolean':
        return value;
      case 'array': {
        if (!Array.isArray(value)) return [];
        const sliced = value.slice(0, 20);
        if (!schema.items) return sliced;
        return sliced.map(item => this.sanitizeArgsBySchema(item, schema.items, depth + 1));
      }
      case 'object': {
        if (typeof value !== 'object') return {};
        const props = schema.properties || {};
        const keys = Object.keys(props);
        if (keys.length === 0) {
          const out: Record<string, any> = {};
          const entries = Object.entries(value).slice(0, 10);
          for (const [key, val] of entries) {
            if (val === null || val === undefined) continue;
            if (typeof val === 'string') out[key] = this.sanitizeString(val, 120);
            else if (typeof val === 'number' || typeof val === 'boolean') out[key] = val;
            else if (Array.isArray(val)) out[key] = `[${val.length} items]`;
            else if (typeof val === 'object') out[key] = '{…}';
          }
          return out;
        }

        const out: Record<string, any> = {};
        for (const key of keys) {
          if (value[key] === undefined) continue;
          out[key] = this.sanitizeArgsBySchema(value[key], props[key], depth + 1);
        }
        return out;
      }
      default:
        return value;
    }
  }

  private truncateArgs(_toolName: string, sanitizedArgs: any, _originalLength: number): any {
    return {
      ...(sanitizedArgs.nodeId && { nodeId: sanitizedArgs.nodeId }),
      ...(sanitizedArgs.name && { name: sanitizedArgs.name }),
    };
  }
}
