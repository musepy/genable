/**
 * @file toolCallHandler.ts
 * @description IPC handler for TOOL_CALL events — thin router.
 *
 * Delegates to command handlers in src/ipc/commands/.
 * Only responsibilities: route, catch, emit result.
 *
 * Runtime-flag plumbing: the sandbox-side ToolDispatcher passes
 * `agentBehaviorConfig.variableResolution` via the IPC `context` field. We
 * mirror it into a main-thread module-level state so handlers (mode-coverage
 * check etc.) can read it without per-call threading. See spec §7.1.
 */

import { emit } from '@create-figma-plugin/utilities';
import { logger } from '../../utils/logger';
import { dispatchCommand } from '../commands';
import { setVariableResolutionMode } from '../../engine/actions/handlers/modeCoverageCheck';
import {
  setRyowCreatedThisTurn,
  clearRyowCreatedThisTurn,
} from '../../engine/actions/handlers/variableBindingHandler';
import type { ToolContext } from '../../engine/agent/tools/types';

export interface ToolCallData {
  toolName: string;
  parameters: any;
  requestId: string;
  /**
   * Optional runtime flags from the sandbox-side AgentRuntime. Currently
   * threads `variableResolution` to the mode-coverage checker.
   */
  context?: ToolContext;
}

export async function handleToolCall(data: ToolCallData): Promise<void> {
  const { toolName, parameters, requestId, context } = data;

  // Apply runtime flags from context BEFORE dispatching. Per-call apply is
  // deliberate: the agent config could in principle change between calls
  // (e.g. test scenarios that flip the resolver mode mid-session), and we
  // want each tool call to see the value from its own dispatch.
  if (context && context.variableResolution) {
    setVariableResolutionMode(context.variableResolution);
  }

  // RYOW snapshot — used by variableBindingHandler to break bare-name
  // autopick ties in favor of variables created this turn (spec §5.1).
  // Replace the snapshot every call (not append) — the set shrinks at
  // turn boundaries when AgentRuntime clears its store. When `context` is
  // absent or omits the field, clear so non-runtime callers (tests, manual
  // IPC) get legacy first-match behavior.
  if (context && Array.isArray(context.ryowCreatedThisTurnIds)) {
    setRyowCreatedThisTurn(new Set(context.ryowCreatedThisTurnIds));
  } else {
    clearRyowCreatedThisTurn();
  }

  try {
    const response = await dispatchCommand(toolName, parameters);
    emit('TOOL_RESULT', { requestId, response });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[toolCallHandler] ${toolName} threw: ${message}`);
    emit('TOOL_RESULT', {
      requestId,
      response: {
        error: message,
      },
    });
  }
}
