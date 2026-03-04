/**
 * @file toolResultCleaner.ts
 * @description Logic for cleaning and sanitizing tool results and calls to prevent context bloat.
 */

import { LLMToolCall } from '../../llm-client/providers/types';
import { ToolDefinition, ToolParameter } from '../tools/types';
import { CONTEXT_CONSTANTS } from './constants';

export class ToolResultCleaner {
  private toolMap: Map<string, ToolDefinition>;

  /**
   * Visual props essential for LLM to "see" the design.
   * These are preserved in read_node results instead of being stripped.
   */
  private static readonly INSPECT_PRESERVE_PROPS = new Set([
    'name', 'fills', 'strokes', 'layoutMode', 'gap', 'padding',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontSize', 'fontWeight', 'characters', 'cornerRadius',
    'width', 'height', 'layoutSizingHorizontal', 'layoutSizingVertical',
    'primaryAxisAlignItems', 'counterAxisAlignItems',
    'opacity', 'visible', 'effects', 'strokeWeight',
  ]);

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

    const dataJson = JSON.stringify(cleaned.data);
    const MAX_DATA_CHARS = CONTEXT_CONSTANTS.TOOL_RESULT_MAX_DATA_CHARS;

    // For oversized results, attempt structural cleaning if possible
    if (dataJson.length > MAX_DATA_CHARS) {
      // read: use structural cleaning that preserves visual props
      if (cleaned.name === 'read') {
        cleaned.data = this.cleanInspectResult(cleaned.data);
        return cleaned;
      }

      const isSpecializedTool = cleaned.name === 'create' ||
                                cleaned.name === 'edit';
      if (isSpecializedTool && cleaned.data) {
        // For these tools, use structural distillation rather than string truncation
        cleaned.data = cleaned.data.results 
          ? this.cleanBatchResult(cleaned.data, dataJson.length) 
          : this.cleanSuccessfulResult(cleaned.data, dataJson.length);
        return cleaned;
      }
      
      if (cleaned.success && typeof cleaned.data === 'object') {
        // Attempt structural cleaning for oversized successful objects
        cleaned.data = this.cleanSuccessfulResult(cleaned.data, dataJson.length);
        return cleaned;
      }

      // Final fallback for non-object, failures, or non-specialized large data
      const idMap = cleaned.data?.idMap;
      cleaned.data = {
        _truncated: true,
        _originalSize: dataJson.length,
        summary: dataJson.substring(0, 500) + '...',
        // Always preserve idMap if it exists at the top level of data
        ...(idMap && { idMap })
      };
      return cleaned;
    }

    // Results within budget
    if (cleaned.name === 'read') {
      cleaned.data = this.cleanInspectResult(cleaned.data);
    } else if (cleaned.data.results) {
      cleaned.data = this.cleanBatchResult(cleaned.data, dataJson.length);
    } else if (cleaned.success && typeof cleaned.data === 'object') {
      cleaned.data = this.cleanSuccessfulResult(cleaned.data, dataJson.length);
    }

    return cleaned;
  }

  private cleanBatchResult(data: any, originalSize: number): any {
    const essentialData: any = {
      ...(data.idMap && { idMap: data.idMap }),
      results: data.results.map((r: any) => ({
        opId: r.opId || (r.action && r.action.tempId),
        action: typeof r.action === 'string' ? r.action : (r.action && r.action.action),
        success: r.success,
        ...(r.nodeId && { nodeId: r.nodeId }),
        ...(r.name && { name: r.name }),
        // TIER 1: Feedback signals
        ...(r.diff && { diff: r.diff }),
        ...(r.diffInfo && { diffInfo: r.diffInfo }),
        ...(r.error && {
          error: typeof r.error === 'string' ? r.error : {
            code: r.error.code,
            message: r.error.message,
            ...(r.error.semanticFeedback && { semanticFeedback: r.error.semanticFeedback })
          }
        }),
        // Post-op anomalies (zero-cost when empty — only present if issues detected)
        ...(Array.isArray(r.anomalies) && r.anomalies.length > 0 && {
          anomalies: this.cleanAnomalies(r.anomalies, 5)
        }),
        ...(Array.isArray(r.children) && {
          children: r.children.map((c: any) => ({
            opId: c.opId,
            success: c.success,
            ...(c.nodeId && { nodeId: c.nodeId }),
            ...(c.name && { name: c.name }),
          }))
        }),
      })),
      // TIER 0: Critical signals
      ...(data.rollback && { rollback: data.rollback }),
      ...(data.firstFailure && { firstFailure: data.firstFailure }),
      ...(data.failureCount && { failureCount: data.failureCount }),
      ...(data.failureActionIds && { failureActionIds: data.failureActionIds }),
      _truncated: true,
      _originalSize: originalSize,
    };

    if (data.layoutSnapshots && typeof data.layoutSnapshots === 'object') {
      essentialData.layoutSnapshots = this.cleanLayoutSnapshots(data.layoutSnapshots, 10);
    }

    return essentialData;
  }

  private cleanSuccessfulResult(data: any, originalSize: number): any {
    const essentialData: any = {};

    // Keep nodeId - essential for chaining operations
    if (data.nodeId) essentialData.nodeId = data.nodeId;
    if (data.id) essentialData.id = data.id;

    // Keep node name and type for context
    if (data.name) essentialData.name = data.name;
    if (data.type) essentialData.type = data.type;

    // Keep parent reference
    if (data.parentId) essentialData.parentId = data.parentId;

    // Keep children skeleton for read_node hierarchy results
    if (Array.isArray(data.children)) {
      essentialData.childrenCount = data.children.length;
      const MAX_CHILDREN_SKELETON = 5;
      essentialData.children = data.children
        .slice(0, MAX_CHILDREN_SKELETON)
        .map((c: any) => this.extractNodeSkeleton(c, 1))
        .filter(Boolean);

      if (data.children.length > MAX_CHILDREN_SKELETON) {
        essentialData._moreChildren = data.children.length - MAX_CHILDREN_SKELETON;
      }
    }

    // TIER 1: Feedback signals
    if (data.diff) essentialData.diff = data.diff;
    if (data.diffInfo) essentialData.diffInfo = data.diffInfo;
    if (data.visibilityWarnings) essentialData.visibilityWarnings = data.visibilityWarnings;
    if (data.visibilityAutoFixed) essentialData.visibilityAutoFixed = data.visibilityAutoFixed;
    // Post-op anomalies (zero-cost when empty — only present if issues detected)
    if (Array.isArray(data.anomalies) && data.anomalies.length > 0) {
      essentialData.anomalies = this.cleanAnomalies(data.anomalies);
    }

    // Preserve idMap and layoutSnapshots
    if (data.idMap && typeof data.idMap === 'object') {
      essentialData.idMap = data.idMap;
    }
    if (data.layoutSnapshots && typeof data.layoutSnapshots === 'object') {
      essentialData.layoutSnapshots = this.cleanLayoutSnapshots(data.layoutSnapshots);
    }

    essentialData._truncated = true;
    essentialData._originalSize = originalSize;

    return essentialData;
  }

  private cleanLayoutSnapshots(snapshots: Record<string, any>, limit?: number): Record<string, any> {
    const entries = Object.entries(snapshots);
    const sliced = limit ? entries.slice(0, limit) : entries;
    
    return Object.fromEntries(
      sliced.map(([opId, snap]: [string, any]) => [
        opId,
        {
          id: snap?.id || snap?.nodeId,
          name: snap?.name,
          type: snap?.type,
          x: snap?.x,
          y: snap?.y,
          width: snap?.width,
          height: snap?.height,
        }
      ])
    );
  }

  private extractNodeSkeleton(node: any, depth: number): any {
    if (!node || depth > 2) return null;
    const skeleton: any = {
      id: node.id,
      name: node.props?.name || node.name,
      type: node.type
    };
    if (Array.isArray(node.children) && node.children.length > 0 && depth < 2) {
      const MAX_CHILDREN_SKELETON = 20;
      skeleton.children = node.children
        .slice(0, MAX_CHILDREN_SKELETON)
        .map((c: any) => this.extractNodeSkeleton(c, depth + 1))
        .filter(Boolean);
      if (node.children.length > MAX_CHILDREN_SKELETON) {
        skeleton._more = node.children.length - MAX_CHILDREN_SKELETON;
      }
    }
    return skeleton;
  }

  // ================================================================
  // read_node-specific cleaning — preserves visual props for LLM
  // ================================================================

  /**
   * Cleans read_node results.
   * XML string results are passed through directly (already compact).
   * Anomalies are preserved as structured JSON.
   */
  private cleanInspectResult(data: any): any {
    // XML format: { xml: string, anomalies?: [] }
    if (typeof data.xml === 'string') {
      const result: any = { xml: data.xml };
      if (Array.isArray(data.anomalies) && data.anomalies.length > 0) {
        result.anomalies = this.cleanAnomalies(data.anomalies);
      }
      // Truncate XML if oversized
      const MAX_XML_CHARS = CONTEXT_CONSTANTS.TOOL_RESULT_MAX_DATA_CHARS;
      if (result.xml.length > MAX_XML_CHARS) {
        result.xml = result.xml.substring(0, MAX_XML_CHARS) + '\n<!-- truncated -->';
        result._truncated = true;
      }
      return result;
    }

    // Selection format: { count, nodes }
    if (Array.isArray(data.nodes)) {
      return {
        count: data.count,
        nodes: data.nodes.map((n: any) => this.extractNodeSkeleton(n, 0)).filter(Boolean),
      };
    }

    // Legacy JSON fallback: NodeLayer (id, type, props, children)
    const cleanedNode = this.extractInspectNode(data, 0);
    if (Array.isArray(data?.anomalies) && data.anomalies.length > 0) {
      cleanedNode.anomalies = this.cleanAnomalies(data.anomalies);
    }
    return cleanedNode;
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
   * Recursively extracts a node while preserving visual props.
   * Deeper and richer than extractNodeSkeleton — enables LLM "vision".
   */
  private extractInspectNode(node: any, depth: number): any {
    const MAX_INSPECT_DEPTH = 4;
    const MAX_INSPECT_CHILDREN = 15;

    const result: any = {
      id: node.id,
      type: node.type,
    };

    // Preserve visual props from the props bag
    if (node.props && typeof node.props === 'object') {
      const kept: Record<string, any> = {};
      for (const [key, value] of Object.entries(node.props)) {
        if (ToolResultCleaner.INSPECT_PRESERVE_PROPS.has(key)) {
          kept[key] = value;
        }
      }
      if (Object.keys(kept).length > 0) {
        result.props = kept;
      }
    }

    // Recurse children with depth control
    if (Array.isArray(node.children) && node.children.length > 0 && depth < MAX_INSPECT_DEPTH) {
      result.children = node.children
        .slice(0, MAX_INSPECT_CHILDREN)
        .map((c: any) => this.extractInspectNode(c, depth + 1));
      if (node.children.length > MAX_INSPECT_CHILDREN) {
        result._moreChildren = node.children.length - MAX_INSPECT_CHILDREN;
      }
    } else if (Array.isArray(node.children)) {
      result.childrenCount = node.children.length;
    }

    return result;
  }

  /**
   * Sanitizes tool calls for history to prevent context bloat.
   */
  public sanitizeToolCallsForHistory(toolCalls: LLMToolCall[]): LLMToolCall[] {
    return toolCalls.map(tc => {
      // Aggressive pruning for large create/edit XML
      if ((tc.name === 'create' || tc.name === 'edit') && typeof tc.args?.xml === 'string' && tc.args.xml.length > 500) {
        return {
          ...tc,
          args: {
            ...(tc.args?.parentId && { parentId: tc.args.parentId }),
            xml: `[_truncated: ${tc.args.xml.length} chars omitted. State tracked by Figma.]`,
            _truncated: true,
            _originalSize: tc.args.xml.length
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

  private truncateArgs(toolName: string, sanitizedArgs: any, originalLength: number): any {
    return {
      _truncated: true,
      _tool: toolName,
      _originalSize: originalLength,
      ...(sanitizedArgs.nodeId && { nodeId: sanitizedArgs.nodeId }),
      ...(sanitizedArgs.name && { name: sanitizedArgs.name }),
    };
  }

  /**
   * Truncates Figma properties to only keep essential visual cues in history.
   */
  private truncateFigmaProps(props: any): any {
    if (!props || typeof props !== 'object') return props;
    const essentialKeys = ['name', 'fills', 'width', 'height', 'layoutMode', 'characters', 'semantic'];
    const truncated: Record<string, any> = {};
    for (const key of essentialKeys) {
      if (props[key] !== undefined) truncated[key] = props[key];
    }
    truncated._othersTruncated = true;
    return truncated;
  }
}
