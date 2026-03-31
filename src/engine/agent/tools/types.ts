/**
 * @file types.ts
 * @description Core types for the Agentic Tool Interface Layer.
 * Defines the structure for tool registration and execution results.
 */

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
  /** Pre-built stderr from command source. presentForLLM passes it through. */
  _stderr?: string;
  /** Pipeline stages for dashboard auto-visualization. Stripped by presentForLLM. */
  _stages?: Array<{ label: string; file: string; durationMs?: number; meta?: Record<string, unknown> }>;
}

/**
 * Tool execution context (e.g., current design system ID, session info).
 */
export interface ToolContext {
  designSystemId?: string;
  sessionId?: string;
  userId?: string;
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
