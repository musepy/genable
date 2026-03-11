/**
 * @file toolResultCleaner.ts
 * @description Logic for cleaning and sanitizing tool results and calls to prevent context bloat.
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
   * Cleans a tool result to prevent context bloat.
   */
  public cleanToolResult(result: any): any {
    if (!result || typeof result !== 'object') return result;

    const cleaned = { ...result };

    // Clean error object
    if (cleaned.error && typeof cleaned.error === 'object') {
      const errorCode = cleaned.error.code;
      const validationDetails =
        errorCode === 'TOOL_VALIDATION_ERROR'
          ? this.cleanValidationErrorDetails(cleaned.error.details)
          : undefined;
      cleaned.error = {
        message: cleaned.error.message || 'Unknown error',
        code: errorCode,
        ...(cleaned.error.semanticFeedback && { semanticFeedback: cleaned.error.semanticFeedback }),
        ...(validationDetails && { details: validationDetails }),
      };
    }

    if (!cleaned.data) return cleaned;

    // read tools: truncate oversized XML at safe boundary
    const READ_TOOLS = new Set(['context', 'outline', 'inspect']);
    if (READ_TOOLS.has(cleaned.name)) {
      cleaned.data = this.cleanInspectResult(cleaned.data);
      return cleaned;
    }

    // create/edit/design: data is already a compact receipt from executor — pass through
    if (cleaned.name === 'create' || cleaned.name === 'edit' || cleaned.name === 'design') {
      return cleaned;
    }

    // query: results already bounded by executor (knowledge: BM25 top-k, guidelines: single topic doc)
    if (cleaned.name === 'query') {
      return cleaned;
    }

    // Generic fallback: cap oversized data for other tools
    const dataJson = JSON.stringify(cleaned.data);
    if (dataJson.length > CONTEXT_CONSTANTS.TOOL_RESULT_MAX_DATA_CHARS) {
      const idMap = cleaned.data?.idMap;
      cleaned.data = { ...(idMap && { idMap }) };
    }

    return cleaned;
  }

  /**
   * Cleans read results. Tree string passed through directly (already compact).
   * Preserves hint/context fields from handler (auto-degradation signals).
   * Safe truncation: cuts at last newline boundary.
   */
  private cleanInspectResult(data: any): any {
    const result: any = {};
    // Support both new `tree` and legacy `xml` field
    const treeContent = data.tree ?? data.xml;
    if (treeContent) result.tree = treeContent;

    // Preserve structured fields from handler
    if (data.hint) result.hint = data.hint;
    if (data.context) result.context = data.context;
    if (data.page) result.page = data.page;
    if (data.selection) result.selection = data.selection;
    if (data.suggestedReads) result.suggestedReads = data.suggestedReads;

    const MAX_CHARS = CONTEXT_CONSTANTS.TOOL_RESULT_MAX_DATA_CHARS;
    if (result.tree && result.tree.length > MAX_CHARS) {
      // Safe truncation at newline boundary (flat ops is line-oriented)
      const lastNewline = result.tree.lastIndexOf('\n', MAX_CHARS);
      const cutPoint = lastNewline > 0 ? lastNewline : MAX_CHARS;
      result.tree = result.tree.substring(0, cutPoint);
    }
    return result;
  }

  private cleanValidationErrorDetails(details: any): any | undefined {
    if (!details || typeof details !== 'object') return undefined;

    const safeMissing = Array.isArray(details.missing)
      ? details.missing
          .slice(0, 20)
          .map((name: any) => this.sanitizeString(name, 80))
      : [];

    const safeInvalid = Array.isArray(details.invalid)
      ? details.invalid.slice(0, 20).map((entry: any) => {
          const sanitized: Record<string, any> = {
            name: this.sanitizeString(entry?.name || '', 80),
            reason: this.sanitizeString(entry?.reason || '', 160),
          };
          if (entry?.mapPath) {
            sanitized.mapPath = this.sanitizeString(entry.mapPath, 120);
          }
          return sanitized;
        })
      : [];

    const safeReceivedKeys = Array.isArray(details.receivedKeys)
      ? details.receivedKeys
          .slice(0, 30)
          .map((name: any) => this.sanitizeString(name, 80))
      : [];

    return {
      tool: typeof details.tool === 'string' ? this.sanitizeString(details.tool, 80) : '',
      mode: typeof details.mode === 'string' ? this.sanitizeString(details.mode, 40) : '',
      missing: safeMissing,
      invalid: safeInvalid,
      receivedKeys: safeReceivedKeys,
      repairHint: typeof details.repairHint === 'string' ? this.sanitizeString(details.repairHint, 240) : '',
    };
  }

  /**
   * Sanitizes tool calls for history to prevent context bloat.
   */
  public sanitizeToolCallsForHistory(toolCalls: LLMToolCall[]): LLMToolCall[] {
    return toolCalls.map(tc => {
      // Strip XML from create/edit history — tool result already has success/idMap feedback.
      // Never leave placeholder text; weak models copy it verbatim as new tool calls.
      if ((tc.name === 'create' || tc.name === 'edit') && typeof tc.args?.xml === 'string' && tc.args.xml.length > 500) {
        return {
          ...tc,
          args: {
            ...(tc.args?.parentId && { parentId: tc.args.parentId }),
          }
        };
      }

      const def = this.toolMap.get(tc.name);
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
