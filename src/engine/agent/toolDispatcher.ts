/**
 * @file toolDispatcher.ts
 * @description Extracted from agentRuntime.ts — encapsulates tool validation,
 * execution dispatch, timeout handling, and result cleaning. Pure class with
 * injected dependencies, no reference to AgentRuntime.
 *
 * CLI form: unwrapRunCommand() now parses CLI strings (e.g. "ls /Card/ -s")
 * and maps them to structured args. Supports && chains.
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
import { getCommandHelp, isValidCommand } from './tools/unified/commandRegistry';
import {
  parseCommandString,
  mapToToolArgs,
  type ParsedChain,
} from './tools/unified/commandParser';

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

  /** Merge additional executors (e.g. when reusing runtime across turns). */
  public mergeExecutors(executors: Record<string, ToolExecutor>): void {
    Object.assign(this.toolExecutors, executors);
  }

  // ─── Run command unwrapping ────────────────────────────────────

  /**
   * Unwrap a `run` tool call into the underlying command.
   *
   * CLI format:
   *   run({command: "ls /"})              → {name: "ls", args: {path: "/"}}
   *   run({command: "cat /Card/ -s"})     → {name: "cat", args: {path: "/Card/", screenshot: true}}
   *   run({command: "design", input: "ops..."}) → {name: "design", args: {ops: "ops..."}}
   *
   * Chain format (returns with __chain metadata, handled in executeTool):
   *   run({command: "tree / && cat /Card/"}) → {name: "run", args: {__chain: ..., input: ...}}
   *
   * Non-`run` tool calls pass through unchanged.
   */
  public static unwrapRunCommand(tc: LLMToolCall): LLMToolCall {
    if (tc.name !== 'run') return tc;

    const command = tc.args?.command;
    if (!command || typeof command !== 'string') return tc;

    const chain = parseCommandString(command);

    // Chain: keep as 'run' with __chain metadata, handled in executeTool
    if (chain.commands.length > 1) {
      return { ...tc, args: { __chain: chain, input: tc.args?.input } };
    }

    // Single command
    const parsed = chain.commands[0];
    if (!parsed || !parsed.name) {
      return { ...tc, args: { __help: true } };
    }

    // Command name only (no positional args, no flags) → help mode
    if (parsed.positionalArgs.length === 0 && Object.keys(parsed.flags).length === 0 && !tc.args?.input) {
      return { ...tc, name: parsed.name, args: { __help: true } };
    }

    const args = mapToToolArgs(parsed, tc.args?.input);
    if (!args) {
      return { ...tc, name: parsed.name, args: { __help: true } };
    }

    return { ...tc, name: parsed.name, args };
  }

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

      // ── Unwrap `run` → command name ──
      // Keep original name for LLMToolResult (Gemini requires functionResponse.name to match)
      const originalName = tc.name;
      const unwrapped = ToolDispatcher.unwrapRunCommand(tc);
      const commandName = unwrapped.name;

      // ── Dispatch tool to executor (using command name for events/display) ──
      const displayMeta = toolDisplayMap[commandName];
      this.config.emitRuntimeEvent({
        type: 'tool_call',
        iteration: iteration + 1,

        phase: 'execution',
        toolCall: { id: tc.id, name: commandName, displayName: displayMeta?.displayName, group: displayMeta?.group, args: unwrapped.args },
      });
      this.config.onToolCall?.(unwrapped);

      const result = await this.executeToolWithTimeout(unwrapped);

      const durationMs = Date.now() - startedAt;
      const resultSuccess = result?.success !== false;

      this.config.onToolResult?.(unwrapped, result);
      const errorMessage = resultSuccess ? undefined : (result?.error?.message || result?.error?.code || 'Tool execution failed');
      this.config.emitRuntimeEvent({
        type: 'tool_result',
        iteration: iteration + 1,

        phase: 'execution',
        toolResult: {
          id: tc.id,
          name: commandName,
          displayName: displayMeta?.displayName,
          group: displayMeta?.group,
          success: resultSuccess,
          durationMs,
          error: errorMessage,
          raw: result,
        },
      });

      // Log design/create failures with per-line details for real-time debugging
      if (!resultSuccess && (commandName === 'design' || commandName === 'create') && errorMessage) {
        console.warn(`[${commandName}] iter=${iteration + 1} ${durationMs}ms\n${errorMessage}`);
      }

      // Extract image attachment before cleaning (prevents base64 truncation by cleaner)
      let imageAttachment: { mimeType: string; data: string } | undefined;
      if (result?.data?.__image) {
        imageAttachment = result.data.__image;
        delete result.data.__image;
      }

      // Clean result and add execution metadata footer for LLM cost awareness
      const cleaned = this.cleanToolResult(result, commandName);
      cleaned._meta = `[${resultSuccess ? 'ok' : 'err'} | ${durationMs}ms]`;

      toolResults.push({
        // Use original name ('run') for Gemini functionResponse.name matching
        name: originalName,
        id: tc.id,
        response: cleaned,
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
        setTimeout(() => reject(new Error(`"${tc.name}" timed out after ${timeout}ms. Try a simpler operation or retry.`)), timeout);
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

    // ── Help mode: return command documentation ──
    if (tc.args?.__help) {
      return { success: true, data: getCommandHelp(tc.name) };
    }

    // ── Chain mode: execute multiple commands sequentially ──
    if (tc.args?.__chain) {
      return this.executeChain(tc.args.__chain as ParsedChain, tc.args?.input);
    }

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
        return { success: false, error: { code: 'NO_TOOL_EXECUTOR', message: `Command "${tc.name}" not available. Available: ${[...this.allowedToolNames].join(', ')}` } };
      }

      // ── Store result for idempotent replay ──
      this.storeIdempotencyResult(tc, result);

      return result;
    } catch (e: any) {
      return {
        success: false,
        error: { code: 'TOOL_EXEC_EXCEPTION', message: `${tc.name}: ${e.message}` },
      };
    }
  }

  // ─── Chain execution ────────────────────────────────────────

  /**
   * Execute a chain of commands sequentially with && semantics.
   * "tree / && cat /Card/" → execute tree, if ok execute cat, return combined.
   *
   * Each command goes through validation and IPC independently.
   * Returns a single combined result for the chain.
   */
  private async executeChain(chain: ParsedChain, input?: string): Promise<any> {
    const results: any[] = [];

    for (let i = 0; i < chain.commands.length; i++) {
      this.config.throwIfCanceled();

      const cmd = chain.commands[i];

      // && semantics: stop on failure
      if (i > 0 && chain.operators[i - 1] === '&&' && results[i - 1]?.success === false) {
        results.push({
          command: cmd.raw,
          success: false,
          error: { code: 'CHAIN_SKIPPED', message: `Skipped — previous command "${chain.commands[i - 1].raw}" failed.` },
        });
        continue;
      }

      // Map CLI args
      const args = mapToToolArgs(cmd, i === 0 ? input : undefined);
      if (!args) {
        results.push({
          command: cmd.raw,
          success: false,
          error: { code: 'PARSE_ERROR', message: `Cannot parse: "${cmd.raw}". Use command name alone for help.` },
        });
        break; // can't continue chain
      }

      // Validate command name
      if (!isValidCommand(cmd.name)) {
        results.push({
          command: cmd.raw,
          success: false,
          error: { code: 'UNKNOWN_COMMAND', message: `Unknown command "${cmd.name}". Available: ls, tree, cat, mk, rm, cp, grep, sed, man` },
        });
        break;
      }

      // Execute via local executor or IPC
      let result: any;
      try {
        const toolExec = this.toolExecutors[cmd.name];
        if (toolExec) {
          result = await toolExec(args);
        }
        if (result == null && this.ipcBridge) {
          result = await this.ipcBridge.callTool(cmd.name, args);
        }
        if (result == null) {
          result = { success: false, error: { code: 'NO_EXECUTOR', message: `No executor for "${cmd.name}".` } };
        }
      } catch (e: any) {
        result = { success: false, error: { code: 'EXEC_ERROR', message: `${cmd.name}: ${e.message}` } };
      }

      results.push({ command: cmd.raw, ...result });
    }

    // Single command in chain → flatten (don't wrap in chain array)
    if (results.length === 1) {
      return results[0];
    }

    return {
      success: results.every(r => r.success !== false),
      data: { chain: results },
    };
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
    if (tc.name === 'create' || tc.name === 'design') {
      return computeRequestHash(canonicalizeCreateParams(tc.args));
    }
    // Generic fallback: hash the stringified args
    return computeRequestHash(JSON.stringify(tc.args));
  }

  private cleanToolResult(result: any, toolName?: string): any {
    return this.cleaner.cleanToolResult({ ...result, ...(toolName && { name: toolName }) });
  }
}
