/**
 * @file incrementalExecutor.ts
 * @description IncrementalExecutor runs compiled FigmaActions one at a time,
 * providing per-line progress events, dependency-skip logic, and optional
 * rollback of all created nodes on failure.
 *
 * It wraps ActionExecutor (which handles the low-level Figma API calls, retry
 * logic, and topological sorting within a batch). IncrementalExecutor adds the
 * outer dependency-skip layer and accumulates the CreateExecutionResult.
 */

import { ActionExecutor } from './executor';
import { FigmaAction } from './types';
import { CreateExecutionResult, LineResult, ParsedLine } from './createTypes';

export type { LineResult, CreateExecutionResult };

// ---------------------------------------------------------------------------
// CompiledEntry / CompilationError stubs
// (mirrors the shapes from compiler.ts so we avoid a circular import path)
// ---------------------------------------------------------------------------

interface CompiledEntry {
  line: ParsedLine;
  action: FigmaAction;
  warnings?: Array<{ code: string; message: string }>;
}

interface CompilationError {
  line: ParsedLine;
  error: string;
}

// ---------------------------------------------------------------------------
// Progress event
// ---------------------------------------------------------------------------

export interface IncrementalProgressEvent {
  lineResult: LineResult;
  stats: { completed: number; total: number };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface IncrementalExecutorOptions {
  /**
   * 'continue' — keep executing subsequent lines even when one fails.
   * 'abort'    — stop processing after the first failure.
   */
  onError: 'continue' | 'abort';
  /**
   * 'none'          — leave any created nodes in place on failure.
   * 'created_nodes' — remove all successfully created nodes when hasErrors is true.
   */
  rollbackMode: 'none' | 'created_nodes';
  /** Real Figma node ID of the default mount point for lines without an explicit parent. */
  parentId?: string;
  /** Called after each line completes (success, failure, or skip). */
  onProgress?: (event: IncrementalProgressEvent) => void;
}

// ---------------------------------------------------------------------------
// IncrementalExecutor
// ---------------------------------------------------------------------------

/**
 * Executes compiled actions one by one, emitting incremental progress events
 * and supporting cross-line dependency tracking.
 *
 * Design intent:
 *   - One ActionExecutor call per line — this gives each line its own tempIdMap
 *     context inside ActionExecutor, but IncrementalExecutor maintains the
 *     authoritative `symbolMap` (symbol → real Figma ID) across all lines.
 *   - Before executing a line, any dependency symbols that previously failed or
 *     were skipped cause the current line to be skipped with 'DEPENDENCY_FAILED'.
 *   - After executing a line, the resolved Figma node ID (if any) is stored in
 *     `symbolMap` so subsequent lines can reference it via their `parentId`.
 */
export class IncrementalExecutor {
  /** Maps binding symbol → real Figma node ID for successfully created nodes. */
  private symbolMap = new Map<string, string>();
  /** Tracks per-symbol terminal status so we can propagate failures to dependents. */
  private statusMap = new Map<string, 'ok' | 'failed' | 'skipped'>();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Execute compiled actions incrementally.
   *
   * @param compiledActions - Output of ActionCompiler.compile().actions
   * @param parseErrors     - Output of ActionCompiler.compile().errors (lines that failed parsing/compilation)
   * @param options         - Execution options (onError, rollbackMode, onProgress, …)
   */
  async execute(
    compiledActions: CompiledEntry[],
    parseErrors: CompilationError[],
    options: IncrementalExecutorOptions,
  ): Promise<CreateExecutionResult> {
    // Reset state for a fresh run
    this.symbolMap.clear();
    this.statusMap.clear();

    const total = compiledActions.length + parseErrors.length;
    const lineResults: LineResult[] = [];
    /** Tracks { symbol, nodeId } pairs so we can roll back if needed. */
    const createdNodes: Array<{ symbol: string; nodeId: string }> = [];
    let completed = 0;
    let aborted = false;

    // ---- 1. Seed lineResults with parse/compilation errors ----
    for (const ce of parseErrors) {
      const lr: LineResult = {
        line: ce.line.lineNumber ?? 0,
        raw: ce.line.raw ?? '',
        status: 'failed',
        command: ce.line.command,
        symbol: ce.line.symbol,
        error: ce.error,
      };
      if (ce.line.symbol) {
        this.statusMap.set(ce.line.symbol, 'failed');
      }
      lineResults.push(lr);
      completed++;
      options.onProgress?.({ lineResult: lr, stats: { completed, total } });
    }

    // ---- 2. Execute compiled actions one by one ----
    for (const entry of compiledActions) {
      const { line, action } = entry;

      // ---- 2a. Short-circuit: abort mode triggered by a previous failure ----
      if (aborted) {
        const lr = this.makeSkippedResult(line, 'ABORTED');
        if (line.symbol) this.statusMap.set(line.symbol, 'skipped');
        lineResults.push(lr);
        completed++;
        options.onProgress?.({ lineResult: lr, stats: { completed, total } });
        continue;
      }

      // ---- 2b. Dependency skip check ----
      const failedDep = this.findFailedDependency(line.dependsOn);
      if (failedDep !== null) {
        const lr = this.makeSkippedResult(line, 'DEPENDENCY_FAILED');
        if (line.symbol) this.statusMap.set(line.symbol, 'skipped');
        lineResults.push(lr);
        completed++;
        options.onProgress?.({ lineResult: lr, stats: { completed, total } });
        continue;
      }

      // ---- 2c. Resolve symbol references embedded in the action ----
      const resolvedAction = this.resolveActionRefs(action);

      // ---- 2d. Execute via ActionExecutor (single-action batch) ----
      const executor = new ActionExecutor({ onError: 'skip-dependents' });
      let executionResult: Awaited<ReturnType<ActionExecutor['execute']>>;
      try {
        executionResult = await executor.execute([resolvedAction]);
      } catch (e: any) {
        // Unexpected throw from ActionExecutor itself
        const lr: LineResult = {
          line: line.lineNumber ?? 0,
          raw: line.raw ?? '',
          status: 'failed',
          command: line.command,
          symbol: line.symbol,
          error: e?.message ?? 'Unexpected executor error',
        };
        if (line.symbol) this.statusMap.set(line.symbol, 'failed');
        lineResults.push(lr);
        completed++;
        options.onProgress?.({ lineResult: lr, stats: { completed, total } });
        if (options.onError === 'abort') aborted = true;
        continue;
      }

      // ---- 2e. Map the single-action result into a LineResult ----
      const actionResult = executionResult.results[0];
      let succeeded = actionResult?.success ?? false;

      // Merge compiler warnings (sizing defaults) with executor warnings (font fallback, etc.)
      const executorWarnings = actionResult?.warnings?.map(w => ({ code: w.code, message: w.message })) ?? [];
      const compilerWarnings = entry.warnings ?? [];
      const allWarnings = [...compilerWarnings, ...executorWarnings];

      const lr: LineResult = {
        line: line.lineNumber ?? 0,
        raw: line.raw ?? '',
        status: succeeded ? 'ok' : 'failed',
        command: line.command,
        symbol: line.symbol,
        nodeId: succeeded ? (actionResult.nodeId ?? executionResult.idMap[line.symbol ?? '']) : undefined,
        error: succeeded ? undefined : (actionResult?.error ?? 'Unknown error'),
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      };

      // Promote to 'warning' if succeeded but has warnings
      if (succeeded && lr.warnings && lr.warnings.length > 0) {
        lr.status = 'warning';
      }

      // ---- 2e′. Degraded fallback: if a frame failed, create a minimal
      //      placeholder so children aren't cascade-skipped. ----
      if (!succeeded && line.symbol && resolvedAction.action === 'createFrame') {
        const fallbackId = await this.tryDegradedFallback(resolvedAction);
        if (fallbackId) {
          succeeded = true;
          lr.status = 'warning';
          lr.nodeId = fallbackId;
          const origError = lr.error || 'unknown';
          lr.error = undefined;
          lr.warnings = [
            ...(lr.warnings || []),
            { code: 'DEGRADED_FALLBACK', message: `Created as minimal frame (original: ${origError}). Use edit to apply styles.` },
          ];
        }
      }

      // ---- 2f. Update symbolMap and statusMap ----
      if (succeeded && line.symbol) {
        const nodeId = lr.nodeId ?? executionResult.idMap[line.symbol];
        if (nodeId) {
          this.symbolMap.set(line.symbol, nodeId);
          createdNodes.push({ symbol: line.symbol, nodeId });
        }
        this.statusMap.set(line.symbol, 'ok');
      } else if (!succeeded && line.symbol) {
        this.statusMap.set(line.symbol, 'failed');
      }

      lineResults.push(lr);
      completed++;
      options.onProgress?.({ lineResult: lr, stats: { completed, total } });

      // ---- 2g. Abort policy ----
      if (!succeeded && options.onError === 'abort') {
        aborted = true;
      }
    }

    // ---- 3. Compute aggregate stats ----
    const stats = this.computeStats(lineResults);

    // ---- 4. Optional rollback ----
    const hasErrors = lineResults.some(r => r.status === 'failed');
    if (options.rollbackMode === 'created_nodes' && hasErrors) {
      await this.rollbackCreatedNodes(createdNodes);
      // Clear the idMap entries for rolled-back nodes
      for (const { symbol } of createdNodes) {
        this.symbolMap.delete(symbol);
      }
    }

    // ---- 5. Build and return result ----
    const idMap: Record<string, string> = {};
    for (const [sym, nodeId] of this.symbolMap) {
      idMap[sym] = nodeId;
    }

    return {
      success: !hasErrors,
      hasErrors,
      idMap,
      lineResults,
      stats,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check whether any symbol in `deps` has a terminal status of 'failed' or
   * 'skipped'. Returns the first offending symbol, or null if all are ok.
   */
  private findFailedDependency(deps: string[]): string | null {
    for (const dep of deps) {
      const status = this.statusMap.get(dep);
      if (status === 'failed' || status === 'skipped') {
        return dep;
      }
    }
    return null;
  }

  /**
   * Produce a skipped LineResult.
   */
  private makeSkippedResult(line: ParsedLine, skipReason: string): LineResult {
    return {
      line: line.lineNumber ?? 0,
      raw: line.raw ?? '',
      status: 'skipped',
      command: line.command,
      symbol: line.symbol,
      skipReason,
    };
  }

  /**
   * Walk the action and resolve any symbol references (strings that are in
   * `symbolMap`) embedded in `parentId` or `nodeId` fields into real Figma IDs.
   *
   * ActionExecutor has its own internal tempIdMap for intra-batch resolution,
   * but since IncrementalExecutor executes one action per batch, we need to
   * supply the cross-line resolved IDs here so the single-action batch sees the
   * correct real Figma ID rather than a stale symbol string.
   */
  private resolveActionRefs(action: FigmaAction): FigmaAction {
    // Shallow clone to avoid mutating the original compiled action
    const resolved: any = { ...action };

    if (resolved.parentId) {
      // Symbol-first resolution: check symbolMap before treating 'root' as keyword.
      // This allows user-defined symbols named 'root' to shadow the keyword.
      resolved.parentId = this.symbolMap.get(resolved.parentId)
        ?? (resolved.parentId === 'root' ? undefined : resolved.parentId);
    }
    if (resolved.nodeId) {
      resolved.nodeId = this.symbolMap.get(resolved.nodeId) ?? resolved.nodeId;
    }

    // CreateInstance: resolve source.nodeId (component reference from a prior line)
    if (resolved.source?.nodeId) {
      resolved.source = { ...resolved.source };
      resolved.source.nodeId = this.symbolMap.get(resolved.source.nodeId) ?? resolved.source.nodeId;
    }

    // SwapInstance: resolve newComponentNodeId (component reference from a prior line)
    if (resolved.newComponentNodeId) {
      resolved.newComponentNodeId = this.symbolMap.get(resolved.newComponentNodeId) ?? resolved.newComponentNodeId;
    }

    // Clear dependsOn — IncrementalExecutor already handles cross-line
    // dependency checks via findFailedDependency(). Leaving unresolved
    // symbol strings in dependsOn causes ActionExecutor to treat them as
    // Figma node IDs, fail the lookup, and incorrectly abort the action.
    delete resolved.dependsOn;

    return resolved as FigmaAction;
  }

  /**
   * Attempt to create a minimal fallback frame when the original createFrame
   * action failed (e.g. due to an invalid property). This prevents the entire
   * subtree from being cascade-skipped.
   *
   * The fallback frame keeps only `name` from the original props — just enough
   * to serve as a valid parent for child nodes.
   *
   * Returns the real Figma node ID on success, or null if even the fallback fails.
   */
  private async tryDegradedFallback(
    originalAction: FigmaAction,
  ): Promise<string | null> {
    const origProps = 'props' in originalAction ? (originalAction as any).props : {};
    const fallbackAction: FigmaAction = {
      action: 'createFrame',
      tempId: originalAction.tempId,
      parentId: originalAction.parentId,
      props: { name: origProps?.name || 'Fallback' },
    };

    try {
      const executor = new ActionExecutor({ onError: 'skip-dependents' });
      const result = await executor.execute([fallbackAction]);
      const ar = result.results[0];
      if (ar?.success && ar.nodeId) {
        return ar.nodeId;
      }
    } catch {
      // Fallback also failed (parent doesn't exist, etc.) — give up
    }
    return null;
  }

  /**
   * Delete all nodes that were successfully created during this execution run.
   * Errors during individual node removal are silently swallowed so that one
   * already-removed node does not prevent others from being cleaned up.
   */
  private async rollbackCreatedNodes(
    nodes: Array<{ symbol: string; nodeId: string }>,
  ): Promise<void> {
    // Reverse order so children are removed before parents
    for (const { nodeId } of [...nodes].reverse()) {
      try {
        const node = await figma.getNodeByIdAsync(nodeId) as SceneNode | null;
        if (node && !node.removed) {
          node.remove();
        }
      } catch {
        // Best-effort; continue to next node
      }
    }
  }

  /**
   * Compute aggregate statistics from the collected LineResult array.
   */
  private computeStats(lineResults: LineResult[]): CreateExecutionResult['stats'] {
    let created = 0;
    let failed = 0;
    let skipped = 0;
    let warnings = 0;

    for (const lr of lineResults) {
      switch (lr.status) {
        case 'ok':
          created++;
          break;
        case 'warning':
          created++;
          warnings++;
          break;
        case 'failed':
          failed++;
          break;
        case 'skipped':
          skipped++;
          break;
      }
    }

    return { total: lineResults.length, created, failed, skipped, warnings };
  }
}
