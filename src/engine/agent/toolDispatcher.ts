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
import { classifyError, categoryToErrorCode } from './retryPolicy';
import { getOverflow } from './overflowStore';

import type { ToolExecutor } from './tools/types';
import type { IpcBridge } from './ipcBridge';
import { toolDisplayMap } from './tools';
import { getCommandHelp, isValidCommand, findClosestCommand } from './tools/unified/commandRegistry';
import {
  parseCommandString,
  mapToToolArgs,
  type ParsedChain,
} from './tools/unified/commandParser';
import { presentForLLM } from './tools/unified/presentation';
import { handleScratchCommand } from './scratchpad/handler';

// ---------------------------------------------------------------------------
// Deprecated commands — hidden from LLM + rejected at dispatch
// ---------------------------------------------------------------------------

/** Commands no longer exposed to the LLM. Use jsx/edit instead. */
const DEPRECATED_COMMANDS = new Set(['mk', 'create', 'render']);

/** Helpful migration messages for each deprecated command. */
const DEPRECATED_SUGGESTIONS: Record<string, string> = {
  mk: 'Use jsx({markup: "..."}) for creation or edit({path, props}) for updates.',
  create: 'Use jsx({markup: "..."}) for structured tree creation.',
  render: 'Use jsx({markup: "..."}) for design creation.',
};

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
  /**
   * Async hook interceptor called BEFORE each tool executes.
   * Return 'skip' to skip this tool, 'abort' to stop the loop.
   */
  beforeToolExec?: (tc: LLMToolCall) => Promise<ToolInterceptResult | void>;
  /**
   * Async hook interceptor called AFTER each tool executes.
   * Can modify the result via modifiedResult.
   */
  afterToolExec?: (tc: LLMToolCall, result: any) => Promise<ToolInterceptResult | void>;
  /** Provider-specific tool results formatter. */
  formatToolResults: (results: LLMToolResult[]) => LLMMessage;
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

export class ToolDispatcher {
  /** Last created/modified node ID — expanded as $LAST in commands. */
  private lastNodeId: string | undefined;

  constructor(
    private toolExecutors: Record<string, ToolExecutor>,
    private ipcBridge: IpcBridge | undefined,
    private allowedToolNames: Set<string>,
    private config: ToolDispatcherConfig,
  ) {
    // Register built-in local executors (no IPC needed)
    this.toolExecutors['more'] = async (args: any) => {
      const id = Number(args?.id);
      if (!id || isNaN(id)) {
        return { success: false, error: { code: 'MISSING_ARG', message: 'Usage: more <id>. The id comes from a truncated output message (overflow/N).' } };
      }
      const content = getOverflow(id);
      if (!content) {
        return { success: false, error: { code: 'NOT_FOUND', message: `Overflow ${id} not found or expired. Only the last 5 truncated outputs are kept.` } };
      }
      return { success: true, data: { listing: content } };
    };
  }

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
    if (!command || typeof command !== 'string') {
      // No command → return tool overview as help
      return { ...tc, args: { __help: true } };
    }

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

      // ── Expand $LAST variable ──
      let expandedTc = tc;
      if (this.lastNodeId) {
        // In run CLI commands
        if (tc.name === 'run' && typeof tc.args?.command === 'string' && tc.args.command.includes('$LAST')) {
          expandedTc = { ...tc, args: { ...tc.args, command: tc.args.command.replace(/\$LAST/g, `/#${this.lastNodeId}/`) } };
        }
        // In first-class tools with path arg (inspect, edit)
        else if (typeof tc.args?.path === 'string' && tc.args.path.includes('$LAST')) {
          expandedTc = { ...tc, args: { ...tc.args, path: tc.args.path.replace(/\$LAST/g, `/#${this.lastNodeId}/`) } };
        }
      }

      // ── Unwrap `run` → command name ──
      // Keep original name for LLMToolResult (Gemini requires functionResponse.name to match)
      const originalName = expandedTc.name;
      const unwrapped = ToolDispatcher.unwrapRunCommand(expandedTc);
      const commandName = unwrapped.name;

      // ── Reject deprecated commands (dual guarantee: hidden from description + rejected here) ──
      if (DEPRECATED_COMMANDS.has(commandName)) {
        const suggestion = DEPRECATED_SUGGESTIONS[commandName] || 'Use jsx or edit instead.';
        toolResults.push({
          name: originalName,
          id: tc.id,
          response: {
            success: false,
            error: { code: 'DEPRECATED_COMMAND', message: `"${commandName}" is deprecated. ${suggestion}` },
          },
          thought_signature: tc.thought_signature,
        });
        continue;
      }

      // ── Dispatch tool to executor (using command name for events/display) ──
      const displayMeta = toolDisplayMap[commandName];
      this.config.emitRuntimeEvent({
        type: 'tool_call',
        iteration: iteration + 1,

        phase: 'execution',
        toolCall: { id: tc.id, name: commandName, displayName: displayMeta?.displayName, group: displayMeta?.group, args: unwrapped.args },
      });
      this.config.onToolCall?.(unwrapped);

      // ── beforeToolExec hook interceptor ──
      if (this.config.beforeToolExec) {
        const intercept = await this.config.beforeToolExec(unwrapped);
        if (intercept?.action === 'abort') {
          throw new Error(intercept.reason || 'Aborted by beforeToolExec hook');
        }
        if (intercept?.action === 'skip') {
          // Push a skipped result so the LLM knows
          toolResults.push({
            name: originalName,
            id: tc.id,
            response: {
              success: false,
              error: { code: 'HOOK_SKIPPED', message: intercept.reason || `Command "${commandName}" was blocked.` },
            },
            thought_signature: tc.thought_signature,
          });
          continue;
        }
      }

      let result = await this.executeToolWithTimeout(unwrapped);

      const durationMs = Date.now() - startedAt;

      // ── afterToolExec hook interceptor ──
      if (this.config.afterToolExec) {
        const intercept = await this.config.afterToolExec(unwrapped, result);
        if (intercept?.modifiedResult !== undefined) {
          result = intercept.modifiedResult;
        }
      }

      const resultSuccess = result?.success !== false;

      // ── Track $LAST — extract last created/modified node ID ──
      this.extractLastNodeId(result);

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

      // Extract image attachment before presentation pipe
      let imageAttachment: { mimeType: string; data: string } | undefined;
      if (result?.data?.__image) {
        imageAttachment = result.data.__image;
        delete result.data.__image;
      }

      // Layer 2: single presentation pipe — exit code, meta, stderr, guards
      const presented = presentForLLM(result, commandName, durationMs);

      toolResults.push({
        // Use original name ('run') for Gemini functionResponse.name matching
        name: originalName,
        id: tc.id,
        response: presented,
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
      if (tc.name === 'run') {
        return {
          success: true,
          data: `10 commands available. Run any command name alone for detailed usage.

Read:   ls /path/          tree /path/        cat /path/ [-s]
Write:  mk /path/ [type]   mv /src/ /dest/    rm /path/          cp /src/ /dest/
Search: grep <query>       sed /path/ prop    man [topic]

Glob: /path/Prefix* matches children by pattern. $LAST = last created node ID.
Operators: cmd1 && cmd2 (and)  cmd1 ; cmd2 (seq)  cmd1 || cmd2 (or)
Exit codes: 0 = success, 1 = error, 127 = not found`,
        };
      }
      return { success: true, data: getCommandHelp(tc.name) };
    }

    // ── Scratchpad intercept (sandbox-local, zero IPC) ──
    const scratchResult = await handleScratchCommand(tc.name, tc.args);
    if (scratchResult) return scratchResult;

    // ── Chain mode: execute multiple commands sequentially ──
    if (tc.args?.__chain) {
      return this.executeChain(tc.args.__chain as ParsedChain, tc.args?.input);
    }

    // ── Unknown command guard ──
    if (!this.allowedToolNames.has(tc.name)) {
      const suggestion = findClosestCommand(tc.name);
      const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
      return { success: false, error: { code: 'UNKNOWN_COMMAND', message: `Unknown command "${tc.name}".${hint}` } };
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
        return { success: false, error: { code: 'NO_TOOL_EXECUTOR', message: `Command "${tc.name}" not available.` } };
      }
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
   * Execute a chain of commands with Unix operator semantics.
   *
   * Operators:
   * - `&&` : run next only if previous succeeded (AND)
   * - `||` : run next only if previous failed (OR)
   * - `;`  : run next regardless (SEQ)
   * - `|`  : pipe previous stdout as input to next (PIPE)
   *
   * Each command goes through validation and IPC independently.
   * Returns a single combined result for the chain.
   */
  private async executeChain(chain: ParsedChain, input?: string): Promise<any> {
    const results: any[] = [];
    let pipeData: any = undefined; // data flowing through pipe

    for (let i = 0; i < chain.commands.length; i++) {
      this.config.throwIfCanceled();

      const cmd = chain.commands[i];
      const prevOp = i > 0 ? chain.operators[i - 1] : undefined;
      const prevResult = i > 0 ? results[i - 1] : undefined;
      const prevSuccess = prevResult?.success !== false;

      // ── Operator semantics: decide whether to run this command ──
      if (prevOp === '&&' && !prevSuccess) {
        results.push({
          command: cmd.raw,
          success: false,
          error: { code: 'CHAIN_SKIPPED', message: `Skipped — previous command "${chain.commands[i - 1].raw}" failed. Fix the failing command first, then retry the chain.` },
        });
        continue;
      }

      if (prevOp === '||' && prevSuccess) {
        // || : skip if previous succeeded
        results.push({
          command: cmd.raw,
          success: true,
          data: { skipped: true, reason: 'Previous command succeeded (|| operator).' },
        });
        continue;
      }

      // ; : always run (no skip logic)
      // | : always run (pipe data handled below)

      // $LAST expansion: replace $LAST in positional args with last node path
      if (this.lastNodeId) {
        for (let j = 0; j < cmd.positionalArgs.length; j++) {
          if (cmd.positionalArgs[j].includes('$LAST')) {
            cmd.positionalArgs[j] = cmd.positionalArgs[j].replace(/\$LAST/g, `/#${this.lastNodeId}/`);
          }
        }
      }

      // Map CLI args — pipe operator injects previous result as input
      let cmdInput = i === 0 ? input : undefined;
      if (prevOp === '|' && prevResult) {
        // Pipe: serialize previous result as input for the next command
        cmdInput = typeof prevResult.data === 'string'
          ? prevResult.data
          : JSON.stringify(prevResult.data ?? prevResult);
        pipeData = prevResult;
      }

      const args = mapToToolArgs(cmd, cmdInput);
      if (!args) {
        results.push({
          command: cmd.raw,
          success: false,
          error: { code: 'PARSE_ERROR', message: `Cannot parse: "${cmd.raw}". Run "${cmd.name}" alone for usage help.` },
        });
        break; // can't continue chain
      }

      // Validate command name
      if (!isValidCommand(cmd.name)) {
        results.push({
          command: cmd.raw,
          success: false,
          error: { code: 'UNKNOWN_COMMAND', message: `Unknown command "${cmd.name}".${(() => { const s = findClosestCommand(cmd.name); return s ? ` Did you mean "${s}"?` : ''; })()} Available: ls, tree, cat, mk, mv, rm, cp, grep, sed, man` },
        });
        break;
      }

      // Pipe: inject piped node IDs into args for read commands
      if (prevOp === '|' && pipeData) {
        this.injectPipeData(cmd.name, args, pipeData);
      }

      // Execute via local executor or IPC
      let result: any;
      try {
        // Scratchpad intercept (sandbox-local, zero IPC)
        const scratchResult = await handleScratchCommand(cmd.name, args);
        if (scratchResult) {
          result = scratchResult;
        }

        // Text pipe: grep on piped text content (Unix-style text filtering)
        if (args.__pipedText && cmd.name === 'grep') {
          const text = args.__pipedText as string;
          const query = args.query || cmd.positionalArgs[0] || '';
          delete args.__pipedText;
          if (query) {
            const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const matched = text.split('\n').filter(line => pattern.test(line));
            result = { success: true, data: { listing: matched.join('\n') || '(no matches)' } };
          }
        }

        if (result == null) {
          const toolExec = this.toolExecutors[cmd.name];
          if (toolExec) {
            result = await toolExec(args);
          }
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

      // Track $LAST from chain command results
      this.extractLastNodeId(result);

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

  // ─── $LAST variable tracking ────────────────────────────────

  /**
   * Extract the last created/modified node ID from a tool result.
   * Sources: idMap (mk/design), id (mv/single-node ops).
   */
  /** Figma node IDs are always `digits:digits` */
  private static readonly FIGMA_ID_RE = /^\d+:\d+$/;

  private extractLastNodeId(result: any): void {
    const data = result?.data;
    if (!data || result?.success === false) return;

    let candidate: string | undefined;
    if (data.idMap && typeof data.idMap === 'object') {
      const ids = Object.values(data.idMap);
      if (ids.length > 0) candidate = String(ids[ids.length - 1]);
    } else if (data.id) {
      candidate = String(data.id);
    }

    if (candidate && ToolDispatcher.FIGMA_ID_RE.test(candidate)) {
      this.lastNodeId = candidate;
    }
  }

  // ─── Pipe data injection ────────────────────────────────────

  /**
   * Inject piped data from a previous command into the next command's args.
   *
   * Pipe semantics for design tools:
   * - grep results (node IDs) → cat/tree/sed receive first node's path
   * - grep property discovery → sed receives values for replacement
   * - ls/tree output → grep can search within
   */
  private injectPipeData(commandName: string, args: Record<string, any>, prevResult: any): void {
    const data = prevResult?.data ?? prevResult;

    // Text pipe: listing/tree output → grep does text filtering (Unix-style)
    if (typeof data?.listing === 'string' && commandName === 'grep') {
      // Override grep to do text search on piped content instead of canvas search
      args.__pipedText = data.listing;
    }
    if (typeof data?.tree === 'string' && commandName === 'grep') {
      args.__pipedText = data.tree;
    }

    // grep node search → cat/tree/ls/sed: inject first result's ID as path
    if (data?.results && Array.isArray(data.results) && data.results.length > 0) {
      const firstNode = data.results[0];
      if (firstNode?.id && ['cat', 'tree', 'ls', 'sed', 'mk', 'rm'].includes(commandName)) {
        if (!args.path || args.path === '/') {
          args.path = `/#${firstNode.id}/`;
        }
      }
    }

    // mk/design result (idMap) → cat/tree/ls: inject last created node as path
    if (data?.idMap && typeof data.idMap === 'object') {
      const ids = Object.values(data.idMap);
      if (ids.length > 0 && ['cat', 'tree', 'ls'].includes(commandName)) {
        if (!args.path || args.path === '/') {
          args.path = `/#${ids[ids.length - 1]}/`;
        }
      }
    }
  }

}
