/**
 * @file createTypes.ts
 * @description Type definitions for the create/edit tools.
 *
 * The create tool accepts XML design markup. These types define the
 * parameter contract, internal ParsedLine representation, per-line execution
 * results, and overall result shape.
 */

// ==========================================
// ParsedLine (internal compiler input)
// ==========================================

/**
 * Structured representation of a single operation, ready for ActionCompiler.
 * Produced by operationsToParsedLines() from the Operation[] array.
 */
export interface ParsedLine {
  /** 1-based operation index */
  lineNumber: number;
  /** JSON summary of the original operation (for diagnostics) */
  raw: string;
  /** Binding name (symbol), e.g. "header" */
  symbol?: string;
  /** Normalized command: create | update | delete | icon | image */
  command: string;
  /** For `create`: the Figma node type (FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, etc.) */
  nodeType?: string;
  /** For `update` / `delete`: the target node reference (symbol or Figma ID) */
  targetRef?: string;
  /** The parent node reference */
  parentRef?: string;
  /** Properties object */
  props?: Record<string, any>;
  /**
   * Auto-computed list of symbol references this line depends on.
   * A reference is a dependency if it doesn't contain `:` (not a real Figma ID)
   * and is not the literal keyword "root".
   */
  dependsOn: string[];
}

// ==========================================
// Tool Parameters
// ==========================================

/**
 * Parameters accepted by the create tool.
 */
export interface CreateParams {
  /** XML design markup. Nesting implies parent-child. */
  xml: string;
  /** Real Figma node ID to use as the root mount point. Defaults to current page. */
  parentId?: string;
  /** Strategy when a line fails. 'continue' skips failed lines; 'abort' stops execution. Default: 'continue'. */
  onError?: 'continue' | 'abort';
  /** Whether to roll back created nodes on failure. Default: 'none'. */
  rollbackMode?: 'none' | 'created_nodes';
}

// ==========================================
// Per-Line Result
// ==========================================

/**
 * Result for a single operation.
 */
export interface LineResult {
  /** 1-based operation index. */
  line: number;
  /** JSON summary of the original operation. */
  raw: string;
  /** Execution outcome for this operation. */
  status: 'ok' | 'failed' | 'skipped' | 'warning';
  /** Parsed command name (e.g. 'create', 'update', 'delete'). */
  command?: string;
  /** Binding symbol if the operation assigned a variable (e.g. 'btn'). */
  symbol?: string;
  /** Real Figma node ID of the created or affected node, if applicable. */
  nodeId?: string;
  /** Error message if status is 'failed'. */
  error?: string;
  /** Human-readable reason if the operation was skipped (e.g. 'DEPENDENCY_FAILED'). */
  skipReason?: string;
  /** Non-fatal warnings emitted during execution. */
  warnings?: Array<{ code: string; message: string }>;
}

// ==========================================
// Overall Result (internal — not exposed to LLM context)
// ==========================================

/**
 * Overall result returned by IncrementalExecutor.
 * The tool executor distills this into a compact receipt before returning.
 */
export interface CreateExecutionResult {
  /** True if all non-skipped operations succeeded. */
  success: boolean;
  /** True if any operation produced a hard failure. */
  hasErrors: boolean;
  /** Maps binding symbol → real Figma node ID for every successfully created node. */
  idMap: Record<string, string>;
  /** Per-operation execution results, in order. */
  lineResults: LineResult[];
  /** Aggregate statistics for the execution. */
  stats: {
    total: number;
    created: number;
    failed: number;
    skipped: number;
    warnings: number;
  };
}

// ==========================================
// Valid Commands
// ==========================================

/**
 * @internal
 * Exhaustive list of canonical commands understood by the create tool.
 */
export const VALID_COMMANDS = ['create', 'update', 'delete', 'icon', 'image'] as const;

/** Union type of all valid create commands. */
export type CreateCommand = typeof VALID_COMMANDS[number];

// ==========================================
// Legacy aliases (for gradual migration)
// ==========================================
/** @deprecated Use CreateParams */
export type BuildDesignParams = CreateParams;
/** @deprecated Use CreateExecutionResult */
export type BuildDesignResult = CreateExecutionResult;
/** @deprecated Use CreateCommand */
export type BuildDesignCommand = CreateCommand;
