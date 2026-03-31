/**
 * @file toolDispatcher.ts
 * @description Encapsulates tool validation, execution dispatch, timeout handling,
 * and result cleaning. Pure class with injected dependencies.
 *
 * All tools are first-class — no CLI parsing, no `run` wrapper, no chains.
 */

import { LLMToolCall, LLMToolResult, LLMMessage } from '../llm-client/providers/types';
import { getOverflow } from './overflowStore';

import type { ToolExecutor } from './tools/types';
import type { IpcBridge } from './ipcBridge';
import { findClosestTool } from './tools/unified';
import { presentForLLM } from './tools/unified/presentation';
import { handleScratchCommand } from './scratchpad/handler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuntimeEventPayload {
  type: string;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// ToolLogEntry — structured observability for each tool execution
// ---------------------------------------------------------------------------

export interface ToolLogEntry {
  callId: string;
  toolName: string;
  args: any;
  startedAt: number;
  durationMs: number;
  /** True if this exact call (name + args) was seen before in this run. */
  isDuplicate: boolean;
  /** True if the tool executed but produced no observable change. */
  isNoop: boolean;
  /** Present = failure (ToolResponse convention). Absent = success. */
  error?: string;
}

export interface ToolDispatchResult {
  type: 'continue';
  /** Formatted tool results message to add to context. */
  toolResultsMessage: LLMMessage;
}

/** Hook-style interceptor result for beforeToolExec / afterToolExec. */
export interface ToolInterceptResult {
  action: 'continue' | 'skip' | 'abort';
  reason?: string;
  /** For afterToolExec: override the tool result. */
  modifiedResult?: any;
}

export interface ToolDispatcherConfig {
  toolTimeoutMs: number;
  generateId: (prefix: string) => string;
  normalizeToolCallId: (tc: LLMToolCall, fallbackPrefix: string) => string;
  emitRuntimeEvent: (event: RuntimeEventPayload) => void;
  throwIfCanceled: (iteration?: number) => void;
  onToolCall?: (tc: LLMToolCall) => void;
  onToolResult?: (tc: LLMToolCall, result: any) => void;
  beforeToolExec?: (tc: LLMToolCall) => Promise<ToolInterceptResult | void>;
  afterToolExec?: (tc: LLMToolCall, result: any) => Promise<ToolInterceptResult | void>;
  /** Provider-specific tool results formatter. */
  formatToolResults: (results: LLMToolResult[]) => LLMMessage;
}

// ---------------------------------------------------------------------------
// ToolDispatcher
// ---------------------------------------------------------------------------

/** Fields where $LAST variable should be expanded. */
const LAST_EXPANDABLE_FIELDS = ['node', 'scope', 'dest', 'parent', 'path'];

export class ToolDispatcher {
  /** Last created/modified node ID — expanded as $LAST. */
  private lastNodeId: string | undefined;
  private lastNodeName: string | undefined;

  // ─── Duplicate call tracking ──────────────────────────────
  private callSignatureMap = new Map<string, number>();

  public resetCallTracking(): void {
    this.callSignatureMap.clear();
  }

  private isDuplicateCall(tc: LLMToolCall): boolean {
    const sig = `${tc.name}:${JSON.stringify(tc.args)}`;
    const count = (this.callSignatureMap.get(sig) || 0) + 1;
    this.callSignatureMap.set(sig, count);
    return count > 1;
  }

  // ─── Noop detection ───────────────────────────────────────

  private static isNoopResult(toolName: string, result: any): boolean {
    if (!result || result.error != null) return false;
    const data = result.data;
    if (!data) return false;

    if (toolName === 'edit' && data.edited === 0) return true;
    if (toolName === 'jsx' && data.created === 0) return true;
    if (data.moved === 0 || data.deleted === 0 || data.copied === 0) return true;

    return false;
  }

  constructor(
    private toolExecutors: Record<string, ToolExecutor>,
    private ipcBridge: IpcBridge | undefined,
    private allowedToolNames: Set<string>,
    private config: ToolDispatcherConfig,
  ) {
    // Built-in local executor: `more` — paginates truncated output
    this.toolExecutors['more'] = async (args: any) => {
      const id = Number(args?.id);
      if (!id || isNaN(id)) {
        return { error: 'Usage: more <id>. The id comes from a truncated output message (overflow/N).' };
      }
      const content = getOverflow(id);
      if (!content) {
        return { error: `Overflow ${id} not found or expired. Only the last 5 truncated outputs are kept.` };
      }
      return { data: { listing: content } };
    };
  }

  public mergeExecutors(executors: Record<string, ToolExecutor>): void {
    Object.assign(this.toolExecutors, executors);
  }

  /**
   * Dispatch an array of tool calls — handles execution, timeout,
   * error classification, and result cleaning.
   */
  public async dispatch(
    toolCalls: LLMToolCall[],
    iteration: number,
  ): Promise<ToolDispatchResult> {
    const toolResults: LLMToolResult[] = [];

    for (const tc of toolCalls) {
      this.config.throwIfCanceled(iteration + 1);
      tc.id = this.config.normalizeToolCallId(tc, 'call');
      const startedAt = Date.now();

      // ── Expand $LAST variable in string args ──
      if (this.lastNodeId) {
        const lastRef = this.lastNodeId;
        if (tc.args) {
          for (const field of LAST_EXPANDABLE_FIELDS) {
            if (typeof tc.args[field] === 'string' && tc.args[field].includes('$LAST')) {
              tc.args[field] = tc.args[field].replace(/\$LAST/g, lastRef);
            }
          }
        }
      }

      const toolName = tc.name;

      // ── Dispatch tool event ──
      this.config.emitRuntimeEvent({
        type: 'tool_call',
        iteration: iteration + 1,
        phase: 'execution',
        toolCall: { id: tc.id, name: toolName, args: tc.args },
      });
      this.config.onToolCall?.(tc);

      // ── Duplicate call detection ──
      const isDuplicate = this.isDuplicateCall(tc);

      // ── beforeToolExec hook interceptor ──
      if (this.config.beforeToolExec) {
        const intercept = await this.config.beforeToolExec(tc);
        if (intercept?.action === 'abort') {
          throw new Error(intercept.reason || 'Aborted by beforeToolExec hook');
        }
        if (intercept?.action === 'skip') {
          toolResults.push({
            name: toolName,
            id: tc.id,
            response: {
              error: intercept.reason || `Tool "${toolName}" was blocked.`,
            },
            thought_signature: tc.thought_signature,
          });
          continue;
        }
      }

      let result = await this.executeToolWithTimeout(tc);

      const durationMs = Date.now() - startedAt;

      // ── afterToolExec hook interceptor ──
      if (this.config.afterToolExec) {
        const intercept = await this.config.afterToolExec(tc, result);
        if (intercept?.modifiedResult !== undefined) {
          result = intercept.modifiedResult;
        }
      }

      // ── Noop detection ──
      const isNoop = ToolDispatcher.isNoopResult(toolName, result);

      // ── Track $LAST — extract last created/modified node ID ──
      this.extractLastNodeId(result);

      this.config.onToolResult?.(tc, result);
      const errorMessage = result?.error ? (result.error || 'Tool execution failed') : undefined;

      // ── Emit ToolLogEntry ──
      const logEntry: ToolLogEntry = {
        callId: tc.id,
        toolName,
        args: tc.args,
        startedAt,
        durationMs,
        isDuplicate,
        isNoop,
        error: errorMessage,
      };
      this.config.emitRuntimeEvent({
        type: 'tool_log',
        iteration: iteration + 1,
        logEntry,
      });

      this.config.emitRuntimeEvent({
        type: 'tool_result',
        iteration: iteration + 1,
        phase: 'execution',
        toolResult: {
          id: tc.id,
          name: toolName,
          durationMs,
          error: errorMessage,
          isDuplicate,
          isNoop,
          raw: result,
        },
      });

      // Extract image attachment before presentation pipe
      let imageAttachment: { mimeType: string; data: string } | undefined;
      if (result?.data?.__image) {
        imageAttachment = result.data.__image;
        delete result.data.__image;
      }

      // Presentation pipe — exit code, meta, stderr, guards
      const presented = presentForLLM(result, toolName, durationMs);

      toolResults.push({
        name: toolName,
        id: tc.id,
        response: presented,
        thought_signature: tc.thought_signature,
        imageAttachment,
      });
    }

    const toolResultsMessage = this.config.formatToolResults(toolResults);
    toolResultsMessage.id = this.config.generateId('tol');

    return { type: 'continue', toolResultsMessage };
  }

  // ─── Private helpers ────────────────────────────────────────

  private async executeToolWithTimeout(tc: LLMToolCall): Promise<any> {
    const timeout = this.config.toolTimeoutMs;

    return Promise.race([
      this.executeTool(tc),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`"${tc.name}" timed out after ${timeout}ms. Try a simpler operation or retry.`)), timeout);
      }),
    ]).catch(e => {
      if (e?.code === 'AGENT_CANCELED' || e?.name === 'AgentRuntimeCanceledError') {
        throw e;
      }
      console.error(`[ToolDispatcher] Tool execution failed: ${tc.name}`, e);
      return {
        error: e.message,
      };
    });
  }

  private async executeTool(tc: LLMToolCall): Promise<any> {
    this.config.throwIfCanceled();

    // ── Scratchpad intercept (sandbox-local, zero IPC) ──
    const scratchResult = await handleScratchCommand(tc.name, tc.args);
    if (scratchResult) return scratchResult;

    // ── Unknown tool guard ──
    if (!this.allowedToolNames.has(tc.name)) {
      const suggestion = findClosestTool(tc.name);
      const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
      return { error: `Unknown tool "${tc.name}".${hint}` };
    }

    // ── Execute via local executor or IPC ──
    try {
      let result: any;
      const toolExec = this.toolExecutors[tc.name];
      if (toolExec) {
        result = await toolExec(tc.args);
      }
      if (result == null && this.ipcBridge) {
        result = await this.ipcBridge.callTool(tc.name, tc.args);
      }
      if (result == null) {
        return { error: `Tool "${tc.name}" not available.` };
      }
      return result;
    } catch (e: any) {
      return {
        error: `${tc.name}: ${e.message}`,
      };
    }
  }

  // ─── $LAST variable tracking ────────────────────────────────

  private static readonly FIGMA_ID_RE = /^\d+:\d+$/;

  private extractLastNodeId(result: any): void {
    const data = result?.data;
    if (!data || result?.error != null) return;

    let id: string | undefined;
    if (data.idMap && typeof data.idMap === 'object') {
      const ids = Object.values(data.idMap);
      if (ids.length > 0) id = String(ids[ids.length - 1]);
    } else if (data.id) {
      id = String(data.id);
    }

    if (id && ToolDispatcher.FIGMA_ID_RE.test(id)) {
      this.lastNodeId = id;
      this.lastNodeName = data.name;
    }
  }
}
