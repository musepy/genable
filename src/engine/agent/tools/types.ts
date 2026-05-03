/**
 * @file types.ts
 * @description Core types for the Agentic Tool Interface Layer.
 * Defines the structure for tool registration and execution results.
 */

import type { RyowBlock } from '../ryowStore';

/**
 * Metadata for a tool, used for registration and prompt generation.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  /**
   * Strategy for executing this tool.
   * 'parallel': Can be executed concurrently with other parallel tools (no side effects).
   * 'sequential': Must be executed one-by-one (has side effects like creating nodes).
   */
  executionStrategy: 'parallel' | 'sequential';

  /**
   * Whether this tool mutates Figma state (creates/modifies/deletes nodes).
   * Used by noop detection to decide whether to check for no-change results.
   */
  mutates?: boolean;

  /**
   * Transform the raw `result.data` object into the LLM-visible shape.
   * Called by the presentation pipe after flattening, before meta/stderr/guards.
   * When absent, data passes through unchanged.
   */
  presentForLLM?: (data: any) => any;
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: any[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  maxItems?: number;
  required?: string[];
}

/**
 * Tool-result warning. Carries a stable `code` plus a free-form bag for
 * code-specific data (e.g. `picked_variable_id`, `candidates`, `suggested_id`
 * for `AMBIGUOUS_NAME_AUTOPICK`). LLM-visible — surfaced via the presentation
 * pipe.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §4 (warnings ride
 * in tool results so the LLM can self-correct).
 */
export interface ToolWarning {
  code: string;
  /** Human-readable detail. Optional — the `code` is the contract. */
  message?: string;
  /** Code-specific data — see callsites for shape per code. */
  [key: string]: unknown;
}

/**
 * Standardized response format from a tool execution.
 * Error present = failure. Absence of error = success.
 *
 * Flat error string (OpenPencil convention):
 *   { error: "Node '0:5' not found" }
 * No nested { code, message } — LLM reads one string, done.
 */
export interface ToolResponse<T = any> {
  data?: T;
  error?: string;
  /**
   * Non-fatal warnings emitted during execution. Both success and partial-
   * failure responses may carry warnings (e.g. AMBIGUOUS_NAME_AUTOPICK on
   * a successful set_fill).
   */
  warnings?: ToolWarning[];
  /**
   * Read-your-own-writes block — variable / collection state from the
   * current turn. Attached only to responses from variable-related tools
   * (see `VARIABLE_RELATED_TOOLS` in `ryowStore.ts`). The runtime injects
   * this in afterToolExec.
   */
  _ryow?: RyowBlock;
  /** Pipeline stages for dashboard auto-visualization. Stripped by presentForLLM. */
  _stages?: Array<{ label: string; file: string; durationMs?: number; meta?: Record<string, unknown> }>;
}

/**
 * Tool execution context (e.g., current design system ID, session info).
 *
 * Threaded sandbox-side → main-thread on every IPC tool call. Main-thread
 * dispatcher (`src/ipc/handlers/toolCallHandler.ts`) extracts runtime-flag
 * fields and applies them to module-level state before dispatching.
 */
export interface ToolContext {
  designSystemId?: string;
  sessionId?: string;
  userId?: string;
  /**
   * Active variable-resolver phase. Spec §5.4 / §7.1. Threaded from
   * `agentBehaviorConfig.variableResolution` so the main-thread mode-coverage
   * checker can honor the runtime escape valve. 'phase1' bypasses the
   * write-time mode coverage check; 'phase2-mode-coverage' and 'phase2-strict'
   * (default) enable it. Optional — handlers default to 'phase2-strict' when
   * absent.
   */
  variableResolution?: 'phase1' | 'phase2-mode-coverage' | 'phase2-strict' | 'auto';
}

export type RuntimeValidationMode = 'EXECUTION';

export interface RuntimeRequiredParamSpec {
  name: string;
  trim?: boolean;
  check?: 'required';
}


/**
 * Type for a tool execution function.
 * Return null to signal "not handled locally, fall through to IPC".
 */
export type ToolExecutor<P = any, R = any> = (
  params: P,
  context?: ToolContext
) => Promise<ToolResponse<R> | null>;
