/**
 * @file toolDispatcher.ts
 * @description Encapsulates tool validation, execution dispatch, timeout handling,
 * and result cleaning. Pure class with injected dependencies.
 *
 * All tools are first-class — no CLI parsing, no `run` wrapper, no chains.
 */

import { ToolCallBlock, LLMToolResult, LLMMessage } from '../llm-client/providers/types';
import { getOverflow } from './overflowStore';

import type { ToolExecutor } from './tools/types';
import type { IpcBridge } from './ipcBridge';
import { findClosestTool } from './tools/unified';
import { presentForLLM } from './tools/unified/presentation';
import type { ToolLogEntry as ProtocolToolLogEntry } from '../../shared/protocol/agentRuntimeEvents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuntimeEventPayload {
  type: string;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// ToolLogEntry — structured observability for each tool execution.
// Re-exported from the protocol so runtime + protocol stay in sync (single
// source of truth lives in `shared/protocol/agentRuntimeEvents.ts`).
// ---------------------------------------------------------------------------

export type ToolLogEntry = ProtocolToolLogEntry;

/** Per-tool raw result — unprocessed by presentForLLM. For runtime state tracking. */
export interface RawToolResult {
  name: string;
  id: string;
  result: any;
  durationMs: number;
  error?: string;
  /** Discriminator for runtime-synthesized errors (see ToolLogEntry.code). */
  code?: string;
}

export interface ToolDispatchResult {
  type: 'continue';
  /** Formatted tool results message for LLM context (post-presentForLLM). */
  toolResultsMessage: LLMMessage;
  /** Raw results before presentation — for runtime state tracking (node IDs, stats). */
  rawResults: RawToolResult[];
}

/** Hook-style interceptor result for beforeToolExec / afterToolExec. */
export interface ToolInterceptResult {
  action: 'continue' | 'skip' | 'abort';
  reason?: string;
  /**
   * Machine-readable discriminator for the skip/abort action
   * (e.g. "CAP_REJECT"). Attached to the synthesized error result so metrics
   * layers can tell a runtime-reject apart from a tool failure.
   */
  code?: string;
  /** For afterToolExec: override the tool result. */
  modifiedResult?: any;
}

export interface ToolDispatcherConfig {
  generateId: (prefix: string) => string;
  normalizeToolCallId: (tc: ToolCallBlock, fallbackPrefix: string) => string;
  emitRuntimeEvent: (event: RuntimeEventPayload) => void;
  throwIfCanceled: (iteration?: number) => void;
  onToolCall?: (tc: ToolCallBlock) => void;
  onToolResult?: (tc: ToolCallBlock, result: any) => void;
  beforeToolExec?: (tc: ToolCallBlock) => Promise<ToolInterceptResult | void>;
  afterToolExec?: (tc: ToolCallBlock, result: any) => Promise<ToolInterceptResult | void>;
  /** Provider-specific tool results formatter. */
  formatToolResults: (results: LLMToolResult[]) => LLMMessage;
  /**
   * Snapshot of runtime flags to propagate as IPC `context` on every tool
   * call. Used to thread per-turn RYOW state to the main-thread variable
   * binding handler. Returns `undefined` when no runtime context applies.
   */
  getRuntimeContext?: () => import('./tools/types').ToolContext | undefined;
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

  private isDuplicateCall(tc: ToolCallBlock): boolean {
    const sig = `${tc.name}:${JSON.stringify(tc.input)}`;
    const count = (this.callSignatureMap.get(sig) || 0) + 1;
    this.callSignatureMap.set(sig, count);
    return count > 1;
  }

  // ─── Noop detection ───────────────────────────────────────

  private static isNoopResult(result: any): boolean {
    if (!result || result.error != null) return false;
    const data = result.data;
    if (!data) return false;

    return data.created === 0
        || data.edited === 0
        || data.moved === 0
        || data.deleted === 0
        || data.copied === 0;
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

  /** Snapshot of all current executors (shallow copy — safe for child config). */
  public getExecutors(): Record<string, ToolExecutor> {
    return { ...this.toolExecutors };
  }

  /** Check if a local executor is registered for the given tool name. */
  public hasExecutor(name: string): boolean {
    return name in this.toolExecutors;
  }

  /**
   * Dispatch an array of tool calls — handles execution, timeout,
   * error classification, and result cleaning.
   */
  public async dispatch(
    toolCalls: ToolCallBlock[],
    iteration: number,
  ): Promise<ToolDispatchResult> {
    const toolResults: LLMToolResult[] = [];
    const rawResults: RawToolResult[] = [];

    for (const tc of toolCalls) {
      this.config.throwIfCanceled(iteration + 1);
      tc.id = this.config.normalizeToolCallId(tc, 'call');
      const startedAt = Date.now();

      // ── Expand $LAST variable in string args ──
      if (this.lastNodeId) {
        const lastRef = this.lastNodeId;
        if (tc.input) {
          for (const field of LAST_EXPANDABLE_FIELDS) {
            if (typeof tc.input[field] === 'string' && tc.input[field].includes('$LAST')) {
              tc.input[field] = tc.input[field].replace(/\$LAST/g, lastRef);
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
        toolCall: { id: tc.id, name: toolName, args: tc.input },
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
          const skipReason = intercept.reason || `Tool "${toolName}" was blocked.`;
          const skipCode = intercept.code;
          const skipDurationMs = Date.now() - startedAt;
          // Synthesized error carries both the human-readable reason (for LLM
          // retry) and an optional `code` discriminator so metrics consumers
          // can exclude runtime rejects from genuine tool-failure counts.
          const skipRaw = skipCode ? { error: skipReason, code: skipCode } : { error: skipReason };
          toolResults.push({
            name: toolName,
            id: tc.id,
            response: skipRaw,
            isError: true,
            thought_signature: tc.thoughtSignature,
          });
          // Emit events so UI/dev-bridge update status (not stuck on "running")
          this.config.emitRuntimeEvent({
            type: 'tool_log',
            iteration: iteration + 1,
            logEntry: {
              callId: tc.id, toolName, args: tc.input,
              startedAt, durationMs: skipDurationMs,
              isDuplicate, isNoop: false, error: skipReason,
              code: skipCode,
            },
          });
          this.config.emitRuntimeEvent({
            type: 'tool_result',
            iteration: iteration + 1,
            phase: 'execution',
            toolResult: {
              id: tc.id, name: toolName, durationMs: skipDurationMs,
              error: skipReason, isDuplicate, isNoop: false,
              code: skipCode,
              raw: skipRaw,
            },
          });
          rawResults.push({ name: toolName, id: tc.id, result: skipRaw, durationMs: skipDurationMs, error: skipReason, code: skipCode  });
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
      const isNoop = ToolDispatcher.isNoopResult(result);

      // ── Track $LAST — extract last created/modified node ID ──
      this.extractLastNodeId(result);

      this.config.onToolResult?.(tc, result);
      const errorMessage = result?.error ? (result.error || 'Tool execution failed') : undefined;

      // ── Emit ToolLogEntry ──
      const logEntry: ToolLogEntry = {
        callId: tc.id,
        toolName,
        args: tc.input,
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

      // Capture raw result BEFORE presentation (for runtime state tracking)
      rawResults.push({ name: toolName, id: tc.id, result, durationMs, error: errorMessage });

      // Extract image attachment before presentation pipe
      let imageAttachment: { mimeType: string; data: string } | undefined;
      if (result?.data?.__image) {
        imageAttachment = result.data.__image;
        delete result.data.__image;
      }

      // Presentation pipe — flatten data, per-tool override, overflow/binary guards
      const presented = presentForLLM(result, toolName);

      toolResults.push({
        name: toolName,
        id: tc.id,
        response: presented,
        isError: presented?.error != null ? true : undefined,
        thought_signature: tc.thoughtSignature,
        imageAttachment,
      });
    }

    const toolResultsMessage = this.config.formatToolResults(toolResults);
    toolResultsMessage.id = this.config.generateId('tol');

    return { type: 'continue', toolResultsMessage, rawResults };
  }

  // ─── Private helpers ────────────────────────────────────────

  /**
   * Execute a tool. No per-tool wall-clock timeout.
   *
   * Why no timeout: Tool-level timeout was a fake error generator — it
   * rejected the Promise.race after N seconds but the underlying work
   * (Figma IPC, child runtime, etc.) kept running. The LLM saw a fake
   * "timed out" failure while the canvas actually had the work completed.
   * This caused the orphan-frame bug in the subtask flow.
   *
   * Real safety nets that ARE in place:
   *   - User cancel (AgentRuntimeCanceledError, immediate)
   *   - TOTAL_GENERATION_BUDGET_MS (5min, AgentRuntime aborts the LLM stream)
   *   - IPC bridge deadlock backstop (ipcBridge.ts internal request timeout)
   */
  private async executeToolWithTimeout(tc: ToolCallBlock): Promise<any> {
    try {
      return await this.executeTool(tc);
    } catch (e: any) {
      if (e?.code === 'AGENT_CANCELED' || e?.name === 'AgentRuntimeCanceledError') {
        throw e;
      }
      console.error(`[ToolDispatcher] Tool execution failed: ${tc.name}`, e);
      return { error: e.message };
    }
  }

  private async executeTool(tc: ToolCallBlock): Promise<any> {
    this.config.throwIfCanceled();

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
        result = await toolExec(tc.input);
      }
      if (result == null && this.ipcBridge) {
        const runtimeCtx = this.config.getRuntimeContext?.();
        result = await this.ipcBridge.callTool(tc.name, tc.input, runtimeCtx);
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
