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

export type { FigmaAction, ExecutionResult, ActionResult } from './types';
export type { BuildDesignParams, BuildDesignResult, LineResult, BuildDesignProgressEvent } from './buildDesignTypes';

// Compiler types (useful for callers that build their own pipelines)
export type { ParsedLine, CompiledEntry, CompilationError, CompilationResult } from './compiler';

// IncrementalExecutor option types
export type { IncrementalExecutorOptions, IncrementalProgressEvent } from './incrementalExecutor';
