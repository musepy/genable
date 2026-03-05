/**
 * @file toolDispatcher.ts
 * @description Extracted from agentRuntime.ts — encapsulates tool validation,
 * execution dispatch, timeout handling, and result cleaning. Pure class with
 * injected dependencies, no reference to AgentRuntime.
 */

import { LLMToolCall, LLMToolResult, LLMMessage } from '../llm-client/providers/types';
import { ToolExecutionCoordinator } from './tools/toolExecutionCoordinator';
import { ToolResultCleaner } from './context/toolResultCleaner';
import { classifyError, categoryToErrorCode } from './retryPolicy';
import { AGENT_RUNTIME_CONSTANTS } from './constants';

import type { ToolExecutor } from './tools/types';
import type { IpcBridge } from './ipcBridge';
import {
  IdempotencyStore,
  computeRequestHash,
  canonicalizeCreateParams,
} from './idempotencyStore';
import { toolDisplayMap, allToolDefinitions } from './tools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuntimeEventPayload {
  type: string;
  [key: string]: any;
}

export interface ToolDispatchResult {
  type: 'continue';
  /** Formatted tool results message to add to context. */
  toolResultsMessage: LLMMessage;
}

export interface ToolDispatcherConfig {
  toolTimeoutMs: number;
  generateId: (prefix: string) => string;
  normalizeToolCallId: (tc: LLMToolCall, fallbackPrefix: string) => string;
  emitRuntimeEvent: (event: RuntimeEventPayload) => void;
  throwIfCanceled: (iteration?: number) => void;
  onToolCall?: (tc: LLMToolCall) => void;
  onToolResult?: (tc: LLMToolCall, result: any) => void;
  /** Provider-specific tool results formatter. */
  formatToolResults: (results: LLMToolResult[]) => LLMMessage;
  /** Returns the current runId for idempotency context. */
  getRunId?: () => string;
}

// ---------------------------------------------------------------------------
// Error used by AgentRuntime for cancellation detection in catch blocks
// ---------------------------------------------------------------------------

/** Sentinel class for canceled-agent detection inside Promise.race. */
class ToolDispatcherCanceledError extends Error {
  public readonly code = 'AGENT_CANCELED';
  constructor(message = 'Canceled') {
    super(message);
    this.name = 'ToolDispatcherCanceledError';
  }
}

// ---------------------------------------------------------------------------
// ToolDispatcher
// ---------------------------------------------------------------------------

/**
 * Tools whose results should be cached for idempotent replay.
 * Auto-derived from ToolDefinition.idempotent flag — no manual sync needed.
 */
const IDEMPOTENT_CACHE_TOOLS = new Set(
  allToolDefinitions.filter(t => t.idempotent).map(t => t.name)
);

export class ToolDispatcher {
  private idempotencyStore = new IdempotencyStore();

  constructor(
    private toolExecutors: Record<string, ToolExecutor>,
    private ipcBridge: IpcBridge | undefined,
    private coordinator: ToolExecutionCoordinator,
    private cleaner: ToolResultCleaner,
    private allowedToolNames: Set<string>,
    private config: ToolDispatcherConfig,
  ) {}

  /**
   * Dispatch an array of tool calls — handles terminal signals, execution,
   * timeout, error classification, and result cleaning.
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

      // ── Dispatch tool to executor ──
      const displayMeta = toolDisplayMap[tc.name];
      this.config.emitRuntimeEvent({
        type: 'tool_call',
        iteration: iteration + 1,

        phase: 'execution',
        toolCall: { id: tc.id, name: tc.name, displayName: displayMeta?.displayName, group: displayMeta?.group, args: tc.args },
      });
      this.config.onToolCall?.(tc);

      const result = await this.executeToolWithTimeout(tc);

      const durationMs = Date.now() - startedAt;
      const resultSuccess = result?.success !== false;

      this.config.onToolResult?.(tc, result);
      const errorMessage = resultSuccess ? undefined : (result?.error?.message || result?.error?.code || 'Tool execution failed');
      this.config.emitRuntimeEvent({
        type: 'tool_result',
        iteration: iteration + 1,

        phase: 'execution',
        toolResult: {
          id: tc.id,
          name: tc.name,
          displayName: displayMeta?.displayName,
          group: displayMeta?.group,
          success: resultSuccess,
          durationMs,
          error: errorMessage,
          raw: result,
        },
      });

      // Log create failures with per-line details for real-time debugging
      if (!resultSuccess && tc.name === 'create' && errorMessage) {
        console.warn(`[create] iter=${iteration + 1} ${durationMs}ms\n${errorMessage}`);
      }

      // Extract image attachment before cleaning (prevents base64 truncation by cleaner)
      let imageAttachment: { mimeType: string; data: string } | undefined;
      if (result?.data?.__image) {
        imageAttachment = result.data.__image;
        delete result.data.__image;
      }

      toolResults.push({
        name: tc.name,
        id: tc.id,
        response: this.cleanToolResult(result, tc.name),
        thought_signature: tc.thought_signature,
        imageAttachment,
      });
    }

    // Format tool results into a message
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
        setTimeout(() => reject(new Error(`Tool execution timed out after ${timeout}ms: ${tc.name}`)), timeout);
      }),
    ]).catch(e => {
      // Re-throw cancellation errors so the caller can handle them
      if (e?.code === 'AGENT_CANCELED' || e?.name === 'AgentRuntimeCanceledError') {
        throw e;
      }
      console.error(`[ToolDispatcher] Tool execution failed: ${tc.name}`, e);
      return {
        success: false,
        error: {
          code: categoryToErrorCode(classifyError(e)),
          message: e.message,
        },
      };
    });
  }

  private async executeTool(tc: LLMToolCall): Promise<any> {
    this.config.throwIfCanceled();
    const toolExec = this.toolExecutors[tc.name];

    const validation = this.coordinator.validateToolCall(
      tc.name,
      tc.args,
      'EXECUTION',
      this.allowedToolNames,
    );
    if (!validation.ok) {
      return { success: false, error: validation.error };
    }

    // ── Idempotency check (before dispatch, covers both local + IPC paths) ──
    const idempotencyKey = this.checkIdempotencyCache(tc);
    if (idempotencyKey && typeof idempotencyKey === 'object') {
      // Cache hit or conflict — return immediately without executing
      return idempotencyKey;
    }

    try {
      let result: any;
      if (toolExec) {
        result = await toolExec(tc.args);
      }
      // Fall through to IPC if no local executor or local executor returned null
      if (result == null && this.ipcBridge) {
        result = await this.ipcBridge.callTool(tc.name, tc.args);
      }
      if (result == null) {
        return { success: false, error: { code: 'NO_TOOL_EXECUTOR', message: `No executor found for tool '${tc.name}'` } };
      }

      // ── Store result for idempotent replay ──
      this.storeIdempotencyResult(tc, result);

      return result;
    } catch (e: any) {
      return {
        success: false,
        error: { code: 'TOOL_EXEC_EXCEPTION', message: e.message },
      };
    }
  }

  // ─── Idempotency helpers ──────────────────────────────────

  /**
   * Check idempotency cache before tool execution.
   *
   * Key = runId:toolCallId (transport-level replay protection).
   * requestHash stored alongside for conflict detection:
   *   - same key + same hash → hit (replay, return cached)
   *   - same key + different hash → conflict (error)
   *   - different key → miss (execute)
   *
   * Returns cached result on hit, error response on conflict, or null on miss.
   */
  private checkIdempotencyCache(tc: LLMToolCall): any | null {
    if (!IDEMPOTENT_CACHE_TOOLS.has(tc.name)) return null;

    const runId = this.config.getRunId?.() ?? '';
    if (!runId || !tc.id) return null;

    this.idempotencyStore.setRunId(runId);
    const requestHash = this.computeToolRequestHash(tc);
    const key = `${runId}:${tc.id}`;

    const cached = this.idempotencyStore.check(key, requestHash);

    if (cached.hit) {
      return cached.result;
    }

    if (cached.conflict) {
      return {
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: `Idempotency key "${key}" was previously used with different parameters. oldHash=${cached.oldHash}, newHash=${cached.newHash}`,
        },
      };
    }

    // Cache miss — store the key on tc for post-execution storage
    (tc as any)._idempotencyKey = key;
    (tc as any)._requestHash = requestHash;
    return null;
  }

  /**
   * Store a tool result after execution for idempotent replay.
   * Only caches successful results — transient failures should remain retryable.
   */
  private storeIdempotencyResult(tc: LLMToolCall, result: any): void {
    const key = (tc as any)._idempotencyKey as string | undefined;
    const hash = (tc as any)._requestHash as string | undefined;
    if (key && hash && result?.success !== false) {
      this.idempotencyStore.set(key, hash, result);
    }
    delete (tc as any)._idempotencyKey;
    delete (tc as any)._requestHash;
  }

  /**
   * Compute a request hash for a tool call based on its args.
   * Currently only create has specialized canonicalization.
   */
  private computeToolRequestHash(tc: LLMToolCall): string {
    if (tc.name === 'create') {
      return computeRequestHash(canonicalizeCreateParams(tc.args));
    }
    // Generic fallback: hash the stringified args
    return computeRequestHash(JSON.stringify(tc.args));
  }

  private cleanToolResult(result: any, toolName?: string): any {
    return this.cleaner.cleanToolResult({ ...result, ...(toolName && { name: toolName }) });
  }
}
