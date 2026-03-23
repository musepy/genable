/**
 * @file createTypes.ts
 * @description Type definitions for the create/edit tools.
 *
 * The create tool accepts XML design markup. These types define the
 * parameter contract, per-line execution results, and overall result shape.
 *
 * ParsedLine is a type alias for OperationIR — both represent a single
 * design operation ready for ActionCompiler.
 */

import type { OperationIR } from '../../domain/design-ir';
import type { FigmaAction } from './types';

// ==========================================
// ParsedLine (alias for OperationIR)
// ==========================================

/**
 * Type alias — ParsedLine is OperationIR.
 * Both represent a single design operation ready for compilation.
 */
export type ParsedLine = OperationIR;

// ==========================================
// Compiled types (Parser → Executor contract)
// ==========================================

/** A single design operation compiled to a FigmaAction, ready for execution. */
export interface DesignOp {
  action: FigmaAction;
  lineNumber: number;
  raw: string;
  symbol?: string;
  dependsOn: string[];
  /** Non-fatal warnings from compilation (e.g. sizing defaults). */
  warnings?: Array<{ code: string; message: string }>;
}

/** A line that failed to parse or compile. */
export interface DesignOpError {
  lineNumber: number;
  raw: string;
  symbol?: string;
  error: string;
}

/** Semantic diagnostic (e.g., unresolved symbol reference warning). */
export interface DesignDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  lineNumber: number;
  symbol?: string;
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
  /** Human-readable node name from the operation's props (e.g. 'Card'). */
  name?: string;
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
    edited: number;
    deleted: number;
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
export const VALID_COMMANDS = ['create', 'update', 'delete', 'icon', 'image', 'instance', 'variantSet'] as const;

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
