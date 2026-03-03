/**
 * @file index.ts
 * @description Barrel export for the actions module.
 *
 * Consumers should import from this file rather than from individual module
 * paths so that internal reorganisations remain transparent.
 */

export { ActionExecutor } from './executor';
export { ActionCompiler } from './compiler';
export { IncrementalExecutor } from './incrementalExecutor';
export { operationsToParsedLines } from './operationAdapter';

export type { FigmaAction, ExecutionResult, ActionResult } from './types';
export type { Operation, BuildDesignParams, BuildDesignResult, LineResult, BuildDesignProgressEvent, ParsedLine } from './buildDesignTypes';

// Compiler types (useful for callers that build their own pipelines)
export type { CompiledEntry, CompilationError, CompilationResult } from './compiler';

// IncrementalExecutor option types
export type { IncrementalExecutorOptions, IncrementalProgressEvent } from './incrementalExecutor';
