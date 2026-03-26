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
  errors?: Record<string, string>;
  /**
   * Strategy for executing this tool. 
   * 'parallel': Can be executed concurrently with other parallel tools (no side effects).
   * 'sequential': Must be executed one-by-one (has side effects like creating nodes).
   */
  executionStrategy: 'parallel' | 'sequential';
  /**
   * Category for phase-based tool grouping in prompts.
   * - 'read': Get information from Figma state
   * - 'knowledge': Search design knowledge base
   * - 'plan': ReAct planning tools
   * - 'create': Create new nodes
   * - 'modify': Modify existing nodes
   * - 'validate': Validate designs
   */
  category?: 'read' | 'plan' | 'create' | 'modify' | 'validate' | 'knowledge' | 'control';
  /**
   * Tool names this tool commonly follows (dependency hints for LLM).
   * Example: setNodeLayout typically follows createNode.
   */
  dependencies?: string[];

  /** UI display metadata — not sent to LLM, only used for rendering. */
  display?: ToolDisplayMeta;

  /**
   * Whether this tool's results should be cached for idempotent replay.
   * When true, ToolDispatcher will cache successful results keyed by
   * runId:toolCallId and replay them on duplicate calls.
   */
  idempotent?: boolean;
}

export interface ToolDisplayMeta {
  /** Human-readable name, e.g. "Build Design" */
  displayName: string;
  /** UI grouping key — tools with the same group collapse together */
  group?: string;
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
 */
export interface ToolResponse<T = any> {
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
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

export interface ToolValidationInvalidParam {
  name: string;
  reason: string;
}

export interface ToolValidationErrorDetail {
  tool: string;
  mode: RuntimeValidationMode;
  missing: string[];
  invalid: ToolValidationInvalidParam[];
  receivedKeys: string[];
  repairHint: string;
}

export type RuntimeToolValidationResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code: 'TOOL_VALIDATION_ERROR';
        message: string;
        details: ToolValidationErrorDetail;
      };
    };

/**
 * Type for a tool execution function.
 * Return null to signal "not handled locally, fall through to IPC".
 */
export type ToolExecutor<P = any, R = any> = (
  params: P,
  context?: ToolContext
) => Promise<ToolResponse<R> | null>;
