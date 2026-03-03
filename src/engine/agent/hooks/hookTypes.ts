/**
 * @file hookTypes.ts
 * @description Type definitions for the event-driven Hook system.
 *
 * Inspired by Gemini CLI's HookRegistry → HookPlanner → HookRunner pipeline.
 * Hooks are async interceptors that plug into the agent loop at well-defined
 * lifecycle points, replacing hard-coded safety guardrails with composable
 * middleware.
 */

import { LLMToolCall, LLMMessage } from '../../llm-client/providers/types';
import { AgentLoopPolicy } from '../agentLoopPolicy';

// ---------------------------------------------------------------------------
// Hook lifecycle events
// ---------------------------------------------------------------------------

/**
 * 5 lifecycle events in the autonomous agent loop:
 *
 * beforeIteration  → after context management, before LLM call
 * afterLLMResponse → after LLM generates, before tool dispatch
 * beforeToolExec   → before a single tool executes
 * afterToolExec    → after a single tool executes (before result enters history)
 * afterIteration   → after all tool results committed to history
 */
export type HookEvent =
  | 'beforeIteration'
  | 'afterLLMResponse'
  | 'beforeToolExec'
  | 'afterToolExec'
  | 'afterIteration';

// ---------------------------------------------------------------------------
// Hook action & result
// ---------------------------------------------------------------------------

/** What the hook instructs the runtime to do. */
export type HookAction = 'continue' | 'skip' | 'abort';

/**
 * Return value from a hook function.
 * Returning `undefined` / `void` is equivalent to `{ action: 'continue' }`.
 */
export interface HookResult {
  /** continue = proceed normally, skip = skip current tool, abort = terminate loop */
  action: HookAction;
  /** Optional message to inject into context as a `user` role message. */
  injectMessage?: string;
  /** Override the tool result (only meaningful for `afterToolExec`). */
  modifiedResult?: any;
  /** Reason string when action is `abort`. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Hook context — what hooks receive
// ---------------------------------------------------------------------------

export interface HookContext {
  /** Current iteration index (0-based). */
  iteration: number;
  /** Maximum iterations allowed. */
  maxIterations: number;
  /** LLM response text (available in afterLLMResponse+). */
  responseText?: string;
  /** All tool calls from this iteration (available in afterLLMResponse+). */
  toolCalls?: LLMToolCall[];
  /** The current tool call being processed (beforeToolExec / afterToolExec). */
  currentToolCall?: LLMToolCall;
  /** The current tool result (afterToolExec only). */
  toolResult?: any;
  /** Direct access to the messages array for reading/injecting messages. */
  messages: LLMMessage[];
  /** Current loop policy (thresholds, budgets). */
  loopPolicy: AgentLoopPolicy;
  /** ID generator. */
  generateId: (prefix: string) => string;
}

// ---------------------------------------------------------------------------
// Hook function & registration
// ---------------------------------------------------------------------------

/** Async hook function. Return void to continue, or a HookResult. */
export type HookFn = (ctx: HookContext) => Promise<HookResult | void>;

export interface HookRegistration {
  /** Unique identifier for this hook (used for unregister). */
  id: string;
  /** Which lifecycle event to subscribe to. */
  event: HookEvent;
  /** Execution priority — lower numbers run first. Default: 100. */
  priority: number;
  /** The hook function. */
  fn: HookFn;
}
