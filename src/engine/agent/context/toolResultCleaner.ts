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

    // read: truncate oversized XML at safe boundary
    if (cleaned.name === 'read') {
      cleaned.data = this.cleanInspectResult(cleaned.data);
      return cleaned;
    }

    // create/edit: data is already a compact receipt from executor — pass through
    if (cleaned.name === 'create' || cleaned.name === 'edit') {
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
   * Cleans read results. XML string passed through directly (already compact).
   * Preserves hint/context fields from handler (auto-degradation signals).
   * Safe truncation: cuts at last `>` or newline to avoid broken XML tags.
   */
  private cleanInspectResult(data: any): any {
    const result: any = { xml: data.xml };

    // Preserve hint and context from handler (auto-degradation, page overview)
    if (data.hint) result.hint = data.hint;
    if (data.context) result.context = data.context;

    const MAX_XML_CHARS = CONTEXT_CONSTANTS.TOOL_RESULT_MAX_DATA_CHARS;
    if (result.xml && result.xml.length > MAX_XML_CHARS) {
      // Safe truncation: find last `>` or newline before limit to avoid broken tags
      let cutPoint = MAX_XML_CHARS;
      const searchRegion = result.xml.substring(Math.max(0, MAX_XML_CHARS - 200), MAX_XML_CHARS);
      const lastCloseTag = searchRegion.lastIndexOf('>');
      const lastNewline = searchRegion.lastIndexOf('\n');
      const bestCut = Math.max(lastCloseTag, lastNewline);
      if (bestCut > 0) {
        cutPoint = Math.max(0, MAX_XML_CHARS - 200) + bestCut + 1;
      }

      result.xml = result.xml.substring(0, cutPoint);
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

  private cleanAnomalies(anomalies: any[], maxAnomalies: number = 12): any[] {
    return anomalies.slice(0, maxAnomalies).map((a: any) => {
      const code = typeof a?.code === 'string'
        ? a.code
        : (typeof a?.type === 'string' ? a.type : 'UNKNOWN_ANOMALY');
      const hints = Array.isArray(a?.hints)
        ? a.hints.slice(0, 5).map((h: any) => this.sanitizeString(h, 200))
        : [];
      return {
        code,
        message: this.sanitizeString(a?.message || '', 300),
        ...(a?.nodeId && { nodeId: a.nodeId }),
        ...(a?.nodeName && { nodeName: this.sanitizeString(a.nodeName, 80) }),
        ...(a?.context && { context: this.cleanAnomalyContext(a.context) }),
        ...(hints.length > 0 && { hints }),
      };
    });
  }

  private cleanAnomalyContext(context: any): any {
    if (!context || typeof context !== 'object') return context;
    const entries = Object.entries(context).slice(0, 12);
    const out: Record<string, any> = {};
    for (const [key, value] of entries) {
      if (value === null || value === undefined) {
        out[key] = value;
        continue;
      }
      if (typeof value === 'string') {
        out[key] = this.sanitizeString(value, 120);
        continue;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        out[key] = value;
        continue;
      }
      if (Array.isArray(value)) {
        out[key] = value.slice(0, 6).map((item: any) => {
          if (item === null || item === undefined) return item;
          if (typeof item === 'string') return this.sanitizeString(item, 80);
          if (typeof item === 'number' || typeof item === 'boolean') return item;
          return '{…}';
        });
        continue;
      }
      out[key] = '{…}';
    }
    return out;
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
