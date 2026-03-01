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
import type { AgentRuntimePhase } from '../../shared/protocol/agentRuntimeEvents';
import type { ToolExecutor } from './tools/types';
import type { IpcBridge } from './ipcBridge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuntimeEventPayload {
  type: string;
  [key: string]: any;
}

export interface ToolDispatchResult {
  /** 'completed' if a terminal signal was received; 'continue' to keep looping. */
  type: 'completed' | 'continue';
  /** Summary from signal(type=complete), if type === 'completed'. */
  completionSummary?: string;
  /** Formatted tool results message to add to context, if type === 'continue'. */
  toolResultsMessage?: LLMMessage;
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

      // ── Terminal action: signal(type=complete) ──
      if (tc.name === 'signal' && tc.args?.type === 'complete') {
        this.config.onToolCall?.(tc);
        this.config.emitRuntimeEvent({
          type: 'tool_call',
          iteration: iteration + 1,
          mode: 'AUTONOMOUS',
          phase: 'execution' as AgentRuntimePhase,
          toolCall: { id: tc.id, name: tc.name, args: tc.args },
        });
        const completionSummary = tc.args.summary || tc.args.title || 'Completed';
        const workflowResponse = { success: true, summary: completionSummary };
        this.config.onToolResult?.(tc, workflowResponse);
        this.config.emitRuntimeEvent({
          type: 'tool_result',
          iteration: iteration + 1,
          mode: 'AUTONOMOUS',
          phase: 'execution' as AgentRuntimePhase,
          toolResult: { id: tc.id, name: tc.name, success: true, durationMs: Date.now() - startedAt, raw: workflowResponse },
        });
        this.config.emitRuntimeEvent({
          type: 'completed',
          phase: 'execution' as AgentRuntimePhase,
          iteration: iteration + 1,
          totalIterations: iteration + 1,
          summary: completionSummary,
        });
        return { type: 'completed', completionSummary };
      }

      // ── Regular tool: dispatch to executor ──
      this.config.emitRuntimeEvent({
        type: 'tool_call',
        iteration: iteration + 1,
        mode: 'AUTONOMOUS',
        phase: 'execution' as AgentRuntimePhase,
        toolCall: { id: tc.id, name: tc.name, args: tc.args },
      });
      this.config.onToolCall?.(tc);

      const result = await this.executeToolWithTimeout(tc);

      this.config.onToolResult?.(tc, result);
      this.config.emitRuntimeEvent({
        type: 'tool_result',
        iteration: iteration + 1,
        mode: 'AUTONOMOUS',
        phase: 'execution' as AgentRuntimePhase,
        toolResult: {
          id: tc.id,
          name: tc.name,
          success: result?.success !== false,
          durationMs: Date.now() - startedAt,
          error: result?.success === false ? (result?.error?.message || result?.error?.code || 'Tool execution failed') : undefined,
          raw: result,
        },
      });

      toolResults.push({
        name: tc.name,
        id: tc.id,
        response: this.cleanToolResult(result, tc.name),
        thought_signature: tc.thought_signature,
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

    try {
      if (toolExec) {
        return await toolExec(tc.args);
      } else if (this.ipcBridge) {
        return await this.ipcBridge.callTool(tc.name, tc.args);
      } else {
        return { success: false, error: { code: 'NO_TOOL_EXECUTOR', message: `No executor found for tool '${tc.name}'` } };
      }
    } catch (e: any) {
      return {
        success: false,
        error: { code: 'TOOL_EXEC_EXCEPTION', message: e.message },
      };
    }
  }

  private cleanToolResult(result: any, toolName?: string): any {
    return this.cleaner.cleanToolResult({ ...result, ...(toolName && { name: toolName }) });
  }
}
