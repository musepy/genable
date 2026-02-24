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
      cleaned.error = {
        message: cleaned.error.message || 'Unknown error',
        code: cleaned.error.code,
        ...(cleaned.error.semanticFeedback && { semanticFeedback: cleaned.error.semanticFeedback })
      };
    }

    if (!cleaned.data) return cleaned;

    const dataJson = JSON.stringify(cleaned.data);
    const MAX_DATA_CHARS = CONTEXT_CONSTANTS.TOOL_RESULT_MAX_DATA_CHARS;

    // For oversized results, attempt structural cleaning if possible
    if (dataJson.length > MAX_DATA_CHARS) {
      const isSpecializedTool = cleaned.name === 'applyDesignPatch' || 
                                cleaned.name === 'generateDesign' || 
                                cleaned.name === 'batchOperations' ||
                                cleaned.name === 'renderElement' ||
                                cleaned.name === 'patchElement';
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
    if (cleaned.data.results && cleaned.data.idMap) {
      cleaned.data = this.cleanBatchResult(cleaned.data, dataJson.length);
    } else if (cleaned.success && typeof cleaned.data === 'object') {
      cleaned.data = this.cleanSuccessfulResult(cleaned.data, dataJson.length);
    }

    return cleaned;
  }

  private cleanBatchResult(data: any, originalSize: number): any {
    const essentialData: any = {
      idMap: data.idMap, // Always keep full idMap
      results: data.results.map((r: any) => ({
        opId: r.opId,
        action: r.action,
        success: r.success,
        ...(r.nodeId && { nodeId: r.nodeId }),
        ...(r.name && { name: r.name }),
        // TIER 1: Feedback signals
        ...(r.diff && { diff: r.diff }),
        ...(r.diffInfo && { diffInfo: r.diffInfo }),
        ...(r.error && {
          error: {
            code: r.error.code,
            message: r.error.message,
            ...(r.error.semanticFeedback && { semanticFeedback: r.error.semanticFeedback })
          }
        }),
        // Post-op anomalies (zero-cost when empty — only present if issues detected)
        ...(r.anomalies && { anomalies: r.anomalies }),
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

    // Keep children skeleton for inspectDesign hierarchy results
    if (Array.isArray(data.children)) {
      essentialData.childrenCount = data.children.length;
      const MAX_CHILDREN_SKELETON = 20;
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
    if (data.anomalies) essentialData.anomalies = data.anomalies;

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

  /**
   * Sanitizes tool calls for history to prevent context bloat.
   */
  public sanitizeToolCallsForHistory(toolCalls: LLMToolCall[]): LLMToolCall[] {
    return toolCalls.map(tc => {
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
    if (toolName === 'batchOperations' && Array.isArray(sanitizedArgs.operations)) {
      return {
        operations: sanitizedArgs.operations.map((op: any) => ({
          opId: op.opId,
          action: op.action,
          _paramsTruncated: true,
          ...(op.params?.nodeRef && { nodeRef: op.params.nodeRef }),
          ...(op.params?.parentRef && { parentRef: op.params.parentRef }),
          ...(op.params?.nodeId && { nodeId: op.params.nodeId }),
          ...(op.params?.parentId && { parentId: op.params.parentId }),
          ...(op.params?.name && { name: op.params.name }),
          ...(Array.isArray(op.params?.children) && {
            childOpIds: op.params.children.map((c: any) => c.opId).filter(Boolean)
          }),
        })),
        strategy: sanitizedArgs.strategy,
        onError: sanitizedArgs.onError,
        _truncated: true,
        _originalSize: originalLength
      };
    } else if (toolName === 'applyDesignPatch' && Array.isArray(sanitizedArgs.patches)) {
      return {
        patches: sanitizedArgs.patches.map((p: any) => ({
          nodeId: p.nodeId || p.nodeRef,
          _hasLayout: !!p.layout,
          _hasStyles: !!p.styles,
          _hasProperties: !!p.properties,
        })),
        _truncated: true,
        _originalSize: originalLength
      };
    } else if (toolName === 'renderElement' && sanitizedArgs.element) {
      return {
        parentId: sanitizedArgs.parentId,
        element: {
          type: sanitizedArgs.element.type,
          props: this.truncateFigmaProps(sanitizedArgs.element.props),
          childrenCount: Array.isArray(sanitizedArgs.element.children) ? sanitizedArgs.element.children.length : 0,
          _childrenTruncated: true
        },
        _truncated: true,
        _originalSize: originalLength
      };
    } else if (toolName === 'patchElement') {
      return {
        nodeId: sanitizedArgs.nodeId,
        fragment: this.truncateFigmaProps(sanitizedArgs.fragment),
        _truncated: true,
        _originalSize: originalLength
      };
    } else {
      return {
        _truncated: true,
        _tool: toolName,
        _originalSize: originalLength,
        ...(sanitizedArgs.nodeId && { nodeId: sanitizedArgs.nodeId }),
        ...(sanitizedArgs.name && { name: sanitizedArgs.name }),
      };
    }
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
