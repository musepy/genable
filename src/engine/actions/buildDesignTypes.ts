/**
 * @file buildDesignTypes.ts
 * @description Type definitions for the build_design tool.
 *
 * The build_design tool accepts a multi-line instruction text where each line
 * is a command (create/update/delete/icon/image). These types define the
 * parameter contract, per-line execution results, and overall result shape.
 */

// ==========================================
// Tool Parameters
// ==========================================

/**
 * Parameters accepted by the build_design tool.
 */
export interface BuildDesignParams {
  /** The instruction text. Each line is one command. The LLM generates this. */
  instructions: string;
  /** Real Figma node ID to use as the root mount point. Defaults to current page. */
  parentId?: string;
  /** Strategy when a line fails. 'continue' skips failed lines; 'abort' stops execution. Default: 'continue'. */
  onError?: 'continue' | 'abort';
  /** Whether to roll back created nodes on failure. Default: 'none'. */
  rollbackMode?: 'none' | 'created_nodes';
  /** Optional step ID for plan tracking / progress reporting. */
  stepId?: string;
}

// ==========================================
// Per-Line Result
// ==========================================

/**
 * Result for a single instruction line.
 */
export interface LineResult {
  /** 1-based line index in the original instructions string. */
  line: number;
  /** The original raw text of the instruction line. */
  raw: string;
  /** Execution outcome for this line. */
  status: 'ok' | 'failed' | 'skipped' | 'warning';
  /** Parsed command name (e.g. 'create', 'update', 'delete'). */
  command?: string;
  /** Binding symbol if the line assigned a variable (e.g. '$btn'). */
  symbol?: string;
  /** Real Figma node ID of the created or affected node, if applicable. */
  nodeId?: string;
  /** Error message if status is 'failed'. */
  error?: string;
  /** Human-readable reason if the line was skipped (e.g. 'DEPENDENCY_FAILED'). */
  skipReason?: string;
  /** Non-fatal warnings emitted during line execution. */
  warnings?: Array<{ code: string; message: string }>;
}

// ==========================================
// Overall Result
// ==========================================

/**
 * Overall result returned by the build_design tool executor.
 */
export interface BuildDesignResult {
  /** True if all non-skipped lines succeeded. */
  success: boolean;
  /** True if any line produced a hard failure. */
  hasErrors: boolean;
  /** Maps binding symbol → real Figma node ID for every successfully created node. */
  idMap: Record<string, string>;
  /** Per-line execution results, in order. */
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
// Progress Event (incremental UI feedback)
// ==========================================

/**
 * IPC event payload emitted after each line completes.
 * Allows the UI to show incremental progress while a build_design call is running.
 */
export interface BuildDesignProgressEvent {
  type: 'BUILD_DESIGN_PROGRESS';
  lineResult: LineResult;
  stats: { completed: number; total: number };
}

// ==========================================
// Command Aliases + Valid Commands
// ==========================================

/**
 * Maps legacy / verbose command names to their canonical short-form equivalents.
 * The parser uses this table to normalise raw instruction text before dispatch.
 */
export const COMMAND_ALIASES: Record<string, string> = {
  createFrame: 'create',
  createText: 'create',
  createShape: 'create',
  setLayout: 'update',
  setStyles: 'update',
  updateProps: 'update',
  createIcon: 'icon',
  deleteNode: 'delete',
};

/**
 * Exhaustive list of canonical commands understood by the build_design parser.
 */
export const VALID_COMMANDS = ['create', 'update', 'delete', 'icon', 'image'] as const;

/** Union type of all valid build_design commands. */
export type BuildDesignCommand = typeof VALID_COMMANDS[number];
