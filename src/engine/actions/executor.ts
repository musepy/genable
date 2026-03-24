/**
 * @file executor.ts
 * @description The ActionExecutor processes a sequential list of Typed Actions,
 * applying them directly to the Figma document. It supports transactions, rollbacks,
 * and dependency validation.
 */

import { FigmaAction, ExecutionResult, ActionResult } from './types';
import { DesignOp, DesignOpError, LineResult, CreateExecutionResult } from './createTypes';
import { ActionValidator } from './validator';
import { fontBus } from '../figma-adapter/resources/FontBus';
import { fetchIconSvg, prefetchIcons } from '../figma-adapter/assets/iconify';
import { parseActionError } from './errorParser';
import { ActionErrorSubCategory } from './errorTypes';
import { normalizeSizing, type SizingMode } from '../utils/LayoutValidator';
import { lowerPaints } from '../figma/figma-lowering';
import { applyProperty } from './handlers';
import { parseRichText } from '../text/richTextParser';
import { toCamelCase } from '../utils/prop-dsl';
import { sortByPropertyOrder, validateDependencies, SELF_GATE_PROPERTIES, PARENT_GATE_PROPERTIES } from './propertyDependencies';
import { expandShorthands } from './expandShorthands';
import { expandMacros } from './macroExpander';

// ---------------------------------------------------------------------------
// Progress event (moved from IncrementalExecutor)
// ---------------------------------------------------------------------------

export interface DesignProgressEvent {
  lineResult: LineResult;
  stats: { completed: number; total: number };
}

export interface DesignExecOptions {
  onError: 'continue' | 'abort';
  rollbackMode: 'none' | 'created_nodes';
  parentId?: string;
  onProgress?: (event: DesignProgressEvent) => void;
}

/** Map FigmaAction.action → canonical command name for receipt stats. */
function actionToCommand(action: string): string {
  if (action === 'updateProps') return 'update';
  if (action === 'delete') return 'delete';
  return 'create';
}

/**
 * Module-level component registry — maps component symbols to real Figma node IDs.
 * Persists across ActionExecutor instances and execute() calls so that a component
 * created in one tool call can be instantiated in a later tool call.
 * Call ActionExecutor.clearComponentRegistry() on session reset ("New Design").
 *
 * SAFETY INVARIANT: Safe because tool dispatch is strictly sequential
 * (for-await in toolDispatcher.ts). If dispatch ever becomes concurrent,
 * these Maps must be replaced with a synchronized structure.
 */
const componentRegistry = new Map<string, string>();
/** Maps toCamelCase(nodeName) → real Figma ID for name-based instance lookup */
const componentNameRegistry = new Map<string, string>();

export class ActionExecutor {
  private tempIdMap = new Map<string, string>(); // tempId → realFigmaId
  private opStatus = new Map<string, { success: boolean; error?: string }>();
  private rollbackStack: Array<{ tempId: string; nodeId: string }> = [];

  constructor(private readonly options: { onError?: 'skip-dependents' | 'abort' } = {}) {}

  /** Clear the persistent component registry (call on session reset / "New Design") */
  static clearComponentRegistry() {
    componentRegistry.clear();
    componentNameRegistry.clear();
  }

  /** Returns the set of known cross-batch symbols for compile-time validation. */
  static getRegisteredSymbols(): ReadonlySet<string> {
    return new Set(componentRegistry.keys());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // executeDesignOps — unified entry point (replaces IncrementalExecutor)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute compiled design operations with cross-line symbol resolution,
   * dependency tracking, progress events, degraded fallback, and rollback.
   *
   * Replaces the old IncrementalExecutor → ActionExecutor 1:1 wrapper pattern.
   */
  async executeDesignOps(
    ops: DesignOp[],
    errors: DesignOpError[],
    options: DesignExecOptions,
  ): Promise<CreateExecutionResult> {
    const symbolMap = new Map<string, string>();
    const statusMap = new Map<string, 'ok' | 'failed' | 'skipped'>();
    const lineResults: LineResult[] = [];
    const createdNodes: Array<{ symbol: string; nodeId: string }> = [];
    const total = ops.length + errors.length;
    let completed = 0;
    let aborted = false;

    // 1. Seed lineResults with parse/compile errors
    for (const e of errors) {
      const lr: LineResult = {
        line: e.lineNumber, raw: e.raw, status: 'failed',
        symbol: e.symbol, error: e.error,
      };
      if (e.symbol) statusMap.set(e.symbol, 'failed');
      lineResults.push(lr);
      completed++;
      options.onProgress?.({ lineResult: lr, stats: { completed, total } });
    }

    // 2. Prefetch icons in parallel before serial execution
    const iconNames = ops
      .filter(o => o.action.action === 'createIcon' && o.action.props?.iconName)
      .map(o => (o.action as any).props.iconName as string);
    if (iconNames.length > 0) {
      await prefetchIcons(iconNames);
    }

    // 3. Execute operations sequentially
    for (const op of ops) {
      const command = actionToCommand(op.action.action);

      // 3a. Abort check
      if (aborted) {
        const lr: LineResult = { line: op.lineNumber, raw: op.raw, status: 'skipped', command, symbol: op.symbol, skipReason: 'ABORTED' };
        if (op.symbol) statusMap.set(op.symbol, 'skipped');
        lineResults.push(lr);
        completed++;
        options.onProgress?.({ lineResult: lr, stats: { completed, total } });
        continue;
      }

      // 3b. Dependency skip
      const failedDep = op.dependsOn.find(dep => {
        const s = statusMap.get(dep);
        return s === 'failed' || s === 'skipped';
      });
      if (failedDep) {
        const lr: LineResult = { line: op.lineNumber, raw: op.raw, status: 'skipped', command, symbol: op.symbol, skipReason: 'DEPENDENCY_FAILED' };
        if (op.symbol) statusMap.set(op.symbol, 'skipped');
        lineResults.push(lr);
        completed++;
        options.onProgress?.({ lineResult: lr, stats: { completed, total } });
        continue;
      }

      // 3c. Resolve symbol references → real Figma IDs
      const { action: resolvedAction, warnings: resolveWarnings, error: resolveError } = this.resolveSymbolRefs(op.action, symbolMap);

      // 3c-fail: Unresolved reference → fail this action immediately
      if (resolveError) {
        const lr: LineResult = { line: op.lineNumber, raw: op.raw, status: 'failed', command, symbol: op.symbol, error: resolveError, warnings: resolveWarnings.length > 0 ? resolveWarnings : undefined };
        if (op.symbol) statusMap.set(op.symbol, 'failed');
        lineResults.push(lr);
        completed++;
        options.onProgress?.({ lineResult: lr, stats: { completed, total } });
        if (options.onError === 'abort') aborted = true;
        continue;
      }

      // 3d. Execute
      let result: Omit<ActionResult, 'action'>;
      try {
        result = await this.executeOneWithRetry(resolvedAction);
      } catch (e: any) {
        const lr: LineResult = { line: op.lineNumber, raw: op.raw, status: 'failed', command, symbol: op.symbol, error: e?.message ?? 'Unexpected executor error' };
        if (op.symbol) statusMap.set(op.symbol, 'failed');
        lineResults.push(lr);
        completed++;
        options.onProgress?.({ lineResult: lr, stats: { completed, total } });
        if (options.onError === 'abort') aborted = true;
        continue;
      }

      let succeeded = result.success ?? false;
      const allWarnings = [
        ...resolveWarnings,
        ...(op.warnings ?? []),
        ...(result.warnings?.map(w => ({ code: w.code, message: w.message })) ?? []),
      ];

      // Extract human-readable name from the action's props (all create actions carry props.name)
      const opName = ('props' in resolvedAction && (resolvedAction as any).props?.name as string | undefined) || undefined;

      const lr: LineResult = {
        line: op.lineNumber, raw: op.raw,
        status: succeeded ? 'ok' : 'failed',
        command, symbol: op.symbol, name: opName,
        nodeId: succeeded ? result.nodeId : undefined,
        error: succeeded ? undefined : (result.error ?? 'Unknown error'),
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      };

      if (succeeded && lr.warnings && lr.warnings.length > 0) lr.status = 'warning';

      // 3e. Degraded fallback for failed frames
      if (!succeeded && op.symbol && resolvedAction.action === 'createFrame') {
        const fallbackId = await this.tryDegradedFallback(resolvedAction);
        if (fallbackId) {
          succeeded = true;
          lr.status = 'warning';
          lr.nodeId = fallbackId;
          const origError = lr.error || 'unknown';
          lr.error = undefined;
          lr.warnings = [...(lr.warnings || []), { code: 'DEGRADED_FALLBACK', message: `Created as minimal frame (original: ${origError}). Use edit to apply styles.` }];
        }
      }

      // 3f. Update maps
      if (succeeded && op.symbol) {
        const nodeId = lr.nodeId;
        if (nodeId) {
          symbolMap.set(op.symbol, nodeId);
          createdNodes.push({ symbol: op.symbol, nodeId });
        }
        statusMap.set(op.symbol, 'ok');
      } else if (!succeeded && op.symbol) {
        statusMap.set(op.symbol, 'failed');
      }

      lineResults.push(lr);
      completed++;
      options.onProgress?.({ lineResult: lr, stats: { completed, total } });
      if (!succeeded && options.onError === 'abort') aborted = true;
    }

    // 4. Stats — categorize by command type
    let createdCount = 0, editedCount = 0, deletedCount = 0, failedCount = 0, skippedCount = 0, warningCount = 0;
    for (const lr of lineResults) {
      if (lr.status === 'failed') { failedCount++; continue; }
      if (lr.status === 'skipped') { skippedCount++; continue; }
      if (lr.status === 'warning') warningCount++;
      // ok or warning — count by command type
      if (lr.command === 'update') editedCount++;
      else if (lr.command === 'delete') deletedCount++;
      else createdCount++;
    }

    // 5. Rollback if needed
    const hasErrors = failedCount > 0;
    if (options.rollbackMode === 'created_nodes' && hasErrors) {
      for (const { nodeId } of [...createdNodes].reverse()) {
        try {
          const node = await figma.getNodeByIdAsync(nodeId) as SceneNode | null;
          if (node && !node.removed) node.remove();
        } catch { /* best-effort */ }
      }
    }

    // 6. Build idMap
    const idMap: Record<string, string> = {};
    for (const [sym, nodeId] of symbolMap) idMap[sym] = nodeId;

    // 7. Tag created nodes with pluginData for session identity
    for (const { nodeId } of createdNodes) {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (node && !node.removed) {
          node.setPluginData('_agent', 'created');
        }
      } catch { /* best-effort tagging */ }
    }

    return {
      success: !hasErrors,
      hasErrors,
      idMap,
      lineResults,
      stats: { total: lineResults.length, created: createdCount, edited: editedCount, deleted: deletedCount, failed: failedCount, skipped: skippedCount, warnings: warningCount },
    };
  }

  /**
   * Resolve symbol references in a FigmaAction using the symbolMap.
   * Returns the resolved action + any warnings/errors.
   * Fail-fast: unresolved parentId/nodeId → error (not silent fallback to page root).
   */
  private resolveSymbolRefs(
    action: FigmaAction,
    symbolMap: Map<string, string>,
  ): { action: FigmaAction; warnings: Array<{ code: string; message: string }>; error?: string } {
    const resolved: any = { ...action };
    const warnings: Array<{ code: string; message: string }> = [];

    if (resolved.parentId) {
      const original = resolved.parentId;
      resolved.parentId = symbolMap.get(resolved.parentId)
        ?? (resolved.parentId === 'root' ? undefined : resolved.parentId);
      // Unresolved non-ID string → fail the action (don't silently create at page root)
      if (resolved.parentId === original && !original.match(/^\d+:\d+$/)) {
        return { action: resolved, warnings, error: `Parent '${original}' not found. Cannot resolve target container.` };
      }
    }
    if (resolved.nodeId) {
      const original = resolved.nodeId;
      resolved.nodeId = symbolMap.get(resolved.nodeId) ?? resolved.nodeId;
      if (resolved.nodeId === original && !original.match(/^\d+:\d+$/)) {
        return { action: resolved, warnings, error: `Node '${original}' not found in current batch.` };
      }
    }
    if (resolved.source?.nodeId) {
      resolved.source = { ...resolved.source };
      resolved.source.nodeId = symbolMap.get(resolved.source.nodeId) ?? resolved.source.nodeId;
    }
    if (resolved.newComponentNodeId) {
      resolved.newComponentNodeId = symbolMap.get(resolved.newComponentNodeId) ?? resolved.newComponentNodeId;
    }
    delete resolved.dependsOn;

    return { action: resolved as FigmaAction, warnings };
  }

  /**
   * Execute one action with auto-retry on known error patterns.
   */
  private async executeOneWithRetry(action: FigmaAction): Promise<Omit<ActionResult, 'action'>> {
    let result = await this.executeOne(action);
    let retryCount = 0;

    while (!result.success && retryCount < 2) {
      const rawError = result.error || 'Unknown error';
      const subCategory = parseActionError(rawError);
      if (subCategory === ActionErrorSubCategory.UNKNOWN || action.action === 'delete') break;

      retryCount++;
      const props = (action as any).props;
      if (props) {
        if (subCategory === ActionErrorSubCategory.NODE_TYPE_CONSTRAINT) break;
        else if (subCategory === ActionErrorSubCategory.FONT_UNLOADED) { props.fontFamily = 'Inter'; props.fontWeight = 'Regular'; }
        else if (subCategory === ActionErrorSubCategory.PAINT_INVALID) { delete props.fills; delete props.strokes; }
        else if (subCategory === ActionErrorSubCategory.EFFECT_INVALID) { delete props.effects; }
        else if (subCategory === ActionErrorSubCategory.PROPERTY_INVALID) {
          for (const [k, v] of Object.entries(props)) {
            if (v === undefined || (typeof v === 'number' && isNaN(v))) delete props[k];
          }
        }
      }
      result = await this.executeOne(action);
    }
    return result;
  }

  /**
   * Degraded fallback: create a minimal frame when the original failed,
   * so child nodes aren't cascade-skipped.
   */
  private async tryDegradedFallback(originalAction: FigmaAction): Promise<string | null> {
    const origProps = 'props' in originalAction ? (originalAction as any).props : {};
    const fallbackAction: FigmaAction = {
      action: 'createFrame',
      tempId: originalAction.tempId,
      parentId: originalAction.parentId,
      props: { name: origProps?.name || 'Fallback' },
    };
    try {
      const result = await this.executeOne(fallbackAction);
      if (result.success && result.nodeId) return result.nodeId;
    } catch { /* fallback failed too */ }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Legacy execute() — kept for direct ActionExecutor usage (e.g. update path)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Main execution entry point.
   * Topologically sorts actions based on dependsOn, then executes.
   */
  async execute(actions: FigmaAction[]): Promise<ExecutionResult> {
    this.tempIdMap.clear();
    this.opStatus.clear();
    this.rollbackStack = [];
    
    const results: ActionResult[] = [];
    const globalOnError = this.options.onError || 'skip-dependents';
    let aborted = false;

    // 0. Macro expansion: 1 action → N actions (grid, outline-offset, etc.)
    const expandedActions = expandMacros(actions);

    // 1. Collect all tempIds within this batch
    const currentBatchTempIds = new Set<string>();
    for (const action of expandedActions) {
      if (action.tempId) currentBatchTempIds.add(action.tempId);
    }

    // 2. Sort actions topologically based on dependsOn to ensure dependencies run first
    const sortedActions = this.topologicalSort(expandedActions);

    // 2. Execute sequentially
    for (const action of sortedActions) {
      if (aborted) {
         results.push({ action, success: false, error: 'Aborted due to prior failure', skipped: true });
         continue;
      }

      // Check dependencies
      if (action.dependsOn && action.dependsOn.length > 0) {
        let missingDep: string | undefined;
        for (const dep of action.dependsOn) {
          if (currentBatchTempIds.has(dep)) {
            const status = this.opStatus.get(dep);
            if (!status || !status.success) {
              missingDep = dep;
              break;
            }
          } else {
            // It might be a real pre-existing Figma node ID. Validate it.
            try {
              const realNode = await figma.getNodeByIdAsync(dep);
              if (!realNode) {
                missingDep = dep;
                break;
              }
            } catch (e) {
              missingDep = dep;
              break;
            }
          }
        }

        if (missingDep) {
          const actionOnError = action.onError || globalOnError;
          results.push({ action, success: false, error: `Dependency '${missingDep}' failed or was not executed.`, skipped: actionOnError === 'skip-dependents' });
          this.opStatus.set(action.tempId || action.action, { success: false });
          if (actionOnError === 'abort') {
            aborted = true;
          }
          continue;
        }
      }

      // Execute action
      let result = await this.executeOne(action);
      let retryCount = 0;
      let retryTried = false;
      let subCategory = ActionErrorSubCategory.UNKNOWN;
      const retryWarnings: Array<{ code: string; severity: 'warning'; message: string }> = [];

      while (!result.success && retryCount < 2) {
        const rawError = result.error || 'Unknown error';
        subCategory = parseActionError(rawError);
        
        if (subCategory !== ActionErrorSubCategory.UNKNOWN && action.action !== 'delete') {
          retryTried = true;
          retryCount++;
          console.warn(`[ActionExecutor] Auto-fixing and retrying action ${action.action} (attempt ${retryCount}) due to ${subCategory}`);
          
          const props = (action as any).props;
          if (props) {
            if (subCategory === ActionErrorSubCategory.NODE_TYPE_CONSTRAINT) {
              // Cannot auto-fix node type mismatch — break to avoid infinite retry
              break;
            } else if (subCategory === ActionErrorSubCategory.FONT_UNLOADED) {
              props.fontFamily = 'Inter';
              props.fontWeight = 'Regular';
            } else if (subCategory === ActionErrorSubCategory.PAINT_INVALID) {
              delete props.fills;
              delete props.strokes;
            } else if (subCategory === ActionErrorSubCategory.EFFECT_INVALID) {
              delete props.effects;
            } else if (subCategory === ActionErrorSubCategory.PROPERTY_INVALID) {
              // Remove NaN/undefined values that commonly trigger this
              for (const [k, v] of Object.entries(props)) {
                if (v === undefined || (typeof v === 'number' && isNaN(v))) {
                  delete props[k];
                }
              }
            }
          }
          result = await this.executeOne(action);
        } else {
          break; // Unrecoverable or unknown error
        }
      }

      if (retryWarnings.length > 0) {
        result.warnings = [...(result.warnings || []), ...retryWarnings];
      }

      if (!result.success) {
        // Attach extra context for logging/reporting
        (result as ActionResult).errorContext = {
          subCategory: subCategory !== ActionErrorSubCategory.UNKNOWN ? subCategory : parseActionError(result.error || ''),
          rawMessage: result.error || 'Unknown error',
          failedNodeId: (action as any).nodeId || action.tempId || action.action,
          retryTried,
          canRetryLocally: false
        };
      }

      results.push({ action, ...result });

      if (action.tempId) {
         this.opStatus.set(action.tempId, { success: result.success, error: result.error });
         if (result.success && result.nodeId) {
            this.tempIdMap.set(action.tempId, result.nodeId);
            if (action.action !== 'delete') {
              this.rollbackStack.push({ tempId: action.tempId, nodeId: result.nodeId });
            }
         }
      }

      // Handle failure policy
      if (!result.success) {
        const actionOnError = action.onError || globalOnError;
        if (actionOnError === 'abort') {
          aborted = true;
        }
      }
    }

    // 4. Rollback on failure if anything failed and we shouldn't keep partials
    // Only trigger global rollback if globalOnError === 'abort'.
    // For 'skip-dependents', we keep other successfully executed nodes.
    const hasFailures = results.some(r => !r.success && !r.skipped);
    const rollbackSummary = await this.rollbackIfNeeded(hasFailures, globalOnError);

    return {
      success: !hasFailures,
      results,
      idMap: Object.fromEntries(this.tempIdMap),
      rollback: rollbackSummary
    };
  }

  private async executeOne(action: FigmaAction): Promise<Omit<ActionResult, 'action'>> {
    try {
      const parentNode = await this.resolveParent(action.parentId);

      // Pre-validation
      let targetNode: SceneNode | null = null;
      if (action.action === 'updateProps' || action.action === 'delete' || action.action === 'move' || action.action === 'componentProperty') {
        const resolvedTargetId = this.resolveId(action.nodeId);
        targetNode = (await figma.getNodeByIdAsync(resolvedTargetId)) as SceneNode;
        if (!targetNode) {
          return { success: false, error: `Node ${action.nodeId} not found` };
        }
      }

      const validation = ActionValidator.validate(action, targetNode, parentNode);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Pre-execution: normalize sizing props to prevent Figma API exceptions
      const props = (action as any).props;
      if (props) {
        const isText = action.action === 'createText' || targetNode?.type === 'TEXT';
        const sizingWarnings = this.normalizeSizingInProps(props, targetNode, parentNode, isText);
        if (sizingWarnings.length > 0) {
          console.warn(`[ActionExecutor] Sizing normalized for ${action.action}:`, sizingWarnings.map(w => w.message));
        }
      }

      // Root node centering for newly created elements
      if (!parentNode && ['createFrame', 'createText', 'createShape', 'createIcon', 'createComponent', 'createInstance', 'cloneNode'].includes(action.action)) {
        (action as any).props = this.centerNodeInViewport((action as any).props, action.action);
      }

      switch (action.action) {
        case 'createFrame': {
          if (action.upsertExisting) {
            const existingFrame = this.findExistingChild(parentNode, action.props.name, 'FRAME');
            if (existingFrame) {
              const { warnings } = await this.applyProps(existingFrame, action.props);
              return { success: true, nodeId: existingFrame.id, warnings: warnings.length ? warnings : undefined };
            }
          }

          const frame = figma.createFrame();
          // Figma injects a default white fill on new frames — clear it so
          // "no fill specified" truly means no fill (least-surprise principle).
          frame.fills = [];
          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(frame);
          }
          try {
            const { warnings } = await this.applyProps(frame, action.props);
            return { success: true, nodeId: frame.id, warnings: warnings.length ? warnings : undefined };
          } catch (e: any) {
            frame.remove();
            throw e;
          }
        }

        case 'createText': {
          if (action.upsertExisting) {
            const existingText = this.findExistingChild(parentNode, action.props.name, 'TEXT');
            if (existingText) {
              const { warnings } = await this.applyTextProps(existingText as TextNode, action.props);
              return { success: true, nodeId: existingText.id, warnings: warnings.length ? warnings : undefined };
            }
          }

          const text = figma.createText();
          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(text);
          }
          try {
            const { warnings } = await this.applyTextProps(text, action.props);
            return { success: true, nodeId: text.id, warnings: warnings.length ? warnings : undefined };
          } catch (e: any) {
            text.remove();
            throw e;
          }
        }

        case 'createShape': {
          const shapeTypeMap: Record<string, string> = {
            RECTANGLE: 'RECTANGLE',
            ELLIPSE: 'ELLIPSE',
            LINE: 'LINE',
            VECTOR: 'VECTOR',
          };
          if (action.upsertExisting) {
            const existingShape = this.findExistingChild(
              parentNode, action.props.name, shapeTypeMap[action.shapeType] || 'RECTANGLE'
            );
            if (existingShape) {
              const { warnings } = await this.applyProps(existingShape, action.props);
              return { success: true, nodeId: existingShape.id, warnings: warnings.length ? warnings : undefined };
            }
          }

          let shape: RectangleNode | EllipseNode | LineNode | VectorNode;
          if (action.shapeType === 'ELLIPSE') shape = figma.createEllipse();
          else if (action.shapeType === 'LINE') shape = figma.createLine();
          else if (action.shapeType === 'VECTOR') shape = figma.createVector();
          else shape = figma.createRectangle();

          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(shape);
          }
          try {
            const { warnings } = await this.applyProps(shape, action.props);
            return { success: true, nodeId: shape.id, warnings: warnings.length ? warnings : undefined };
          } catch (e: any) {
            shape.remove();
            throw e;
          }
        }

        case 'createIcon': {
           if (action.upsertExisting) {
             const existingIcon = this.findExistingChild(parentNode, action.props.name, 'FRAME');
             if (existingIcon) {
               const { warnings } = await this.applyProps(existingIcon, action.props);
               return { success: true, nodeId: existingIcon.id, warnings: warnings.length ? warnings : undefined };
             }
           }

           const iconWarnings: import('./handlers/types').Warning[] = [];
           let svgData = action.props.svgData;
           if (!svgData && action.props.iconName) {
             const fetched = await fetchIconSvg(action.props.iconName);
             if (fetched) {
               svgData = fetched;
             } else {
               iconWarnings.push({
                 code: 'ICON_FETCH_FAILED',
                 severity: 'warning',
                 message: `Icon "${action.props.iconName}" could not be loaded. Use "prefix:name" format (e.g. "lucide:home", "mdi:star"). Rendered as empty placeholder.`,
                 iconName: action.props.iconName,
               });
             }
           }
           const iconParam = svgData || `<svg width="${action.props.width || 24}" height="${action.props.height || 24}"></svg>`;
           const iconNode = figma.createNodeFromSvg(iconParam);
           if (parentNode && 'appendChild' in parentNode) {
             parentNode.appendChild(iconNode);
           }
           try {
             // Rescale SVG proportionally to fit target size (preserves aspect ratio)
             const targetW = action.props.width || 24;
             const targetH = action.props.height || 24;
             const origW = iconNode.width;
             const origH = iconNode.height;
             if (origW > 0 && origH > 0) {
               const scale = Math.min(targetW / origW, targetH / origH);
               iconNode.rescale(scale);
             }

             // Extract vector-specific props — these should penetrate to vector children, not the outer SVG frame
             const iconFills = action.props.fills;
             const iconStrokes = action.props.strokes;
             const iconStrokeWeight = action.props.strokeWeight;
             const propsForFrame = { ...action.props };
             delete propsForFrame.fills;
             delete propsForFrame.strokes;
             delete propsForFrame.strokeWeight;
             delete propsForFrame.width;
             delete propsForFrame.height;
             delete propsForFrame.iconName;
             delete propsForFrame.svgData;

             const { warnings } = await this.applyProps(iconNode, propsForFrame);

             // Tint vector children: only recolor properties that already have values.
             // Fill-based icons (mdi): fills exist → recolor fills. Stroke-based (lucide/tabler): strokes exist → recolor strokes.
             // Brand logos: LLM should omit fills to preserve original colors (enforced via prompt).
             if (iconFills || iconStrokes || iconStrokeWeight !== undefined) {
               const tintColor = iconFills ? lowerPaints(iconFills) : undefined;
               const explicitStrokes = iconStrokes ? lowerPaints(iconStrokes) : undefined;
               for (const child of iconNode.findAll()) {
                 if ('fills' in child && 'strokes' in child) {
                   const childFills = (child as any).fills as readonly Paint[];
                   const childStrokes = (child as any).strokes as readonly Paint[];

                   if (explicitStrokes) {
                     (child as any).strokes = explicitStrokes;
                   } else if (tintColor && Array.isArray(childStrokes) && childStrokes.length > 0) {
                     (child as any).strokes = tintColor;
                   }

                   if (tintColor && Array.isArray(childFills) && childFills.length > 0) {
                     (child as any).fills = tintColor;
                   }
                 }
                 if (iconStrokeWeight !== undefined && 'strokeWeight' in child) {
                   (child as any).strokeWeight = iconStrokeWeight;
                 }
               }
             }

             const allWarnings = [...iconWarnings, ...warnings];
             return { success: true, nodeId: iconNode.id, warnings: allWarnings.length ? allWarnings : undefined };
           } catch (e: any) {
             iconNode.remove();
             throw e;
           }
        }

        case 'createComponent': {
          const comp = figma.createComponent();
          comp.fills = [];
          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(comp);
          }
          try {
            const { warnings } = await this.applyProps(comp, action.props);
            // Register component symbol for cross-batch instance resolution
            if (action.tempId) {
              componentRegistry.set(action.tempId, comp.id);
            }
            // Also register by name for name-based ref() lookup
            if (comp.name) {
              componentNameRegistry.set(toCamelCase(comp.name), comp.id);
            }
            return { success: true, nodeId: comp.id, warnings: warnings.length ? warnings : undefined };
          } catch (e: any) {
            comp.remove();
            throw e;
          }
        }

        case 'createComponentSet': {
          const components: ComponentNode[] = [];
          for (const compId of action.componentIds) {
            const resolvedId = this.resolveId(compId);
            const finalId = resolvedId !== compId ? resolvedId : (componentRegistry.get(compId) || compId);
            const node = await figma.getNodeByIdAsync(finalId);
            if (node && node.type === 'COMPONENT') {
              components.push(node as ComponentNode);
            } else {
              return { success: false, error: `Component "${compId}" not found or not a COMPONENT (resolved to ${finalId})` };
            }
          }
          if (components.length < 2) {
            return { success: false, error: `variantSet requires at least 2 components, got ${components.length}` };
          }
          const setParent = parentNode || figma.currentPage;
          const componentSet = figma.combineAsVariants(components, setParent as BaseNode & ChildrenMixin);
          // combineAsVariants leaves children at absolute positions (NONE layout).
          // Default to HORIZONTAL so itemSpacing/layoutWrap actually take effect.
          const propsWithLayout = { layoutMode: 'HORIZONTAL', ...action.props };
          const { warnings } = await this.applyProps(componentSet, propsWithLayout);
          if (action.tempId) {
            componentRegistry.set(action.tempId, componentSet.id);
          }
          // Also register by name for name-based ref() lookup
          if (componentSet.name) {
            componentNameRegistry.set(toCamelCase(componentSet.name), componentSet.id);
          }
          return { success: true, nodeId: componentSet.id, warnings: warnings.length ? warnings : undefined };
        }

        case 'createInstance': {
          const master = await this.resolveComponent(action.source.componentKey, action.source.nodeId, action.source.variant);
          if (!master) {
            return { success: false, error: 'Component source not found' };
          }
          const instance = master.createInstance();
          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(instance);
          }
          let warnings: any[] = [];
          if (action.props) {
            try {
              ({ warnings } = await this.applyProps(instance, action.props));
            } catch (e: any) {
              instance.remove();
              throw e;
            }
          }
          // Apply overrides: find children by name and apply props
          if (action.overrides) {
            for (const [childName, overrideProps] of Object.entries(action.overrides)) {
              const child = instance.findOne(n => n.name === childName);
              if (child) {
                try {
                  if (child.type === 'TEXT') {
                    const tw = await this.applyTextProps(child as TextNode, overrideProps);
                    if (tw.warnings.length) warnings.push(...tw.warnings);
                  } else {
                    const pw = await this.applyProps(child, overrideProps);
                    if (pw.warnings.length) warnings.push(...pw.warnings);
                  }
                } catch (e: any) {
                  warnings.push({ code: 'OVERRIDE_FAILED', severity: 'warning', message: `Override for '${childName}' failed: ${e.message}` });
                }
              }
            }
          }
          return { success: true, nodeId: instance.id, warnings: warnings.length ? warnings : undefined };
        }

        case 'swapInstance': {
          if (!targetNode || targetNode.type !== 'INSTANCE') {
             return { success: false, error: `Target node ${action.nodeId} is not an INSTANCE` };
          }
          const newMaster = await this.resolveComponent(action.newComponentKey, action.newComponentNodeId);
          if (!newMaster) {
            return { success: false, error: 'New component source not found' };
          }
          // figma plugin API swap components:
          targetNode.swapComponent(newMaster);
          return { success: true, nodeId: targetNode.id };
        }

        case 'cloneNode': {
          // Resolve source: tempIdMap (current batch) → componentRegistry (cross-batch) → raw ID
          const srcId = this.resolveId(action.sourceId);
          const finalSrcId = srcId !== action.sourceId ? srcId : (componentRegistry.get(action.sourceId) || action.sourceId);
          const srcNode = await figma.getNodeByIdAsync(finalSrcId);
          if (!srcNode) {
            return { success: false, error: `Clone source "${action.sourceId}" not found (resolved to ${finalSrcId})` };
          }
          // All SceneNode types support clone() — use type assertion
          const cloned = (srcNode as any).clone() as SceneNode;
          if (parentNode && 'appendChild' in parentNode) {
            parentNode.appendChild(cloned);
          }
          let cloneWarnings: any[] = [];
          // Apply root-level prop overrides
          if (action.props) {
            try {
              if (cloned.type === 'TEXT') {
                const tw = await this.applyTextProps(cloned as TextNode, action.props);
                cloneWarnings.push(...tw.warnings);
              } else {
                const pw = await this.applyProps(cloned, action.props);
                cloneWarnings.push(...pw.warnings);
              }
            } catch (e: any) {
              cloned.remove();
              throw e;
            }
          }
          // Apply child overrides (dot notation: 'ChildName' → find by name, apply props)
          if (action.overrides) {
            for (const [childName, overrideProps] of Object.entries(action.overrides)) {
              if (!('findOne' in cloned)) continue;
              const child = (cloned as FrameNode).findOne(n => n.name === childName);
              if (child) {
                try {
                  if (child.type === 'TEXT') {
                    const tw = await this.applyTextProps(child as TextNode, overrideProps);
                    if (tw.warnings.length) cloneWarnings.push(...tw.warnings);
                  } else {
                    const pw = await this.applyProps(child, overrideProps);
                    if (pw.warnings.length) cloneWarnings.push(...pw.warnings);
                    // Propagate fills/strokes to vector descendants of icon-like frames
                    // (mirrors icon creation behavior at line 667-692)
                    if (child.type === 'FRAME' && 'findAll' in child && (overrideProps.fills || overrideProps.strokes)) {
                      const vectors = (child as FrameNode).findAll(n => 'fills' in n && 'strokes' in n);
                      if (vectors.length > 0) {
                        for (const vec of vectors) {
                          if (overrideProps.strokes) (vec as any).strokes = overrideProps.strokes;
                          if (overrideProps.fills) (vec as any).fills = overrideProps.fills;
                        }
                      }
                    }
                  }
                } catch (e: any) {
                  cloneWarnings.push({ code: 'CLONE_OVERRIDE_FAILED', severity: 'warning', message: `Override for '${childName}' failed: ${e.message}` });
                }
              }
            }
          }
          // If source was a Component, register clone in componentRegistry for variantSet
          if (cloned.type === 'COMPONENT' && action.tempId) {
            componentRegistry.set(action.tempId, cloned.id);
          }
          return { success: true, nodeId: cloned.id, warnings: cloneWarnings.length ? cloneWarnings : undefined };
        }

        case 'updateProps': {
          if (!targetNode) return { success: false, error: 'Node not found' };
          const { warnings, diffs } = targetNode.type === 'TEXT'
            ? await this.applyTextProps(targetNode as TextNode, action.props)
            : await this.applyProps(targetNode, action.props);
          return {
            success: true,
            nodeId: targetNode.id,
            warnings: warnings.length ? warnings : undefined,
            diffs: diffs?.length ? diffs : undefined,
          };
        }

        case 'delete': {
          if (!targetNode) return { success: false, error: 'Node not found' };
          const deleteWarnings: Array<{ code: string; severity: 'warning'; message: string }> = [];
          if (!this.isAgentOwned(targetNode)) {
            deleteWarnings.push({ code: 'NOT_AGENT_OWNED', severity: 'warning', message: `Deleting '${targetNode.name}' (${targetNode.id}) — not created by agent.` });
          }
          if (!targetNode.removed) {
            targetNode.remove();
          }
          return { success: true, nodeId: targetNode.id, warnings: deleteWarnings.length ? deleteWarnings : undefined };
        }

        case 'move': {
          if (!targetNode) return { success: false, error: 'Node not found' };
          const moveWarnings: Array<{ code: string; severity: 'warning'; message: string }> = [];
          if (!this.isAgentOwned(targetNode)) {
            moveWarnings.push({ code: 'NOT_AGENT_OWNED', severity: 'warning', message: `Moving '${targetNode.name}' (${targetNode.id}) — not created by agent.` });
          }
          if (!parentNode || !('insertChild' in parentNode)) {
             return { success: false, error: 'Invalid parent node for move' };
          }
          if (action.index !== undefined) {
             parentNode.insertChild(action.index, targetNode);
          } else {
             parentNode.appendChild(targetNode);
          }
          return { success: true, nodeId: targetNode.id, warnings: moveWarnings.length ? moveWarnings : undefined };
        }

        case 'componentProperty': {
          if (!targetNode) return { success: false, error: 'Component node not found' };
          if (targetNode.type !== 'COMPONENT' && targetNode.type !== 'COMPONENT_SET') {
            return { success: false, error: `Target ${action.nodeId} is not a COMPONENT or COMPONENT_SET (is ${targetNode.type})` };
          }

          const compNode = targetNode as ComponentNode | ComponentSetNode;
          const propType = action.propertyType as 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP';

          // Resolve default value
          let defaultValue: any;
          if (propType === 'BOOLEAN') {
            defaultValue = action.defaultValue === 'false' || action.defaultValue === false ? false : true;
          } else if (propType === 'TEXT') {
            defaultValue = action.defaultValue ?? '';
          } else if (propType === 'INSTANCE_SWAP') {
            // For instance swap, default value should be the component ID of the default instance
            // If targetNodeId is provided and is an instance, use its main component
            defaultValue = '';
          }

          // Add the component property
          const propKey = compNode.addComponentProperty(action.propertyName, propType, defaultValue);

          // Link to target node if specified
          if (action.targetNodeId) {
            const targetRefId = this.resolveId(action.targetNodeId);
            const linkedNode = await figma.getNodeByIdAsync(targetRefId);
            if (linkedNode) {
              const refs = (linkedNode as any).componentPropertyReferences || {};
              if (propType === 'TEXT') {
                (linkedNode as any).componentPropertyReferences = { ...refs, characters: propKey };
              } else if (propType === 'BOOLEAN') {
                (linkedNode as any).componentPropertyReferences = { ...refs, visible: propKey };
              } else if (propType === 'INSTANCE_SWAP') {
                (linkedNode as any).componentPropertyReferences = { ...refs, mainComponent: propKey };
              }
            } else {
              return { success: true, nodeId: compNode.id, warnings: [{ code: 'PROP_LINK_FAILED', severity: 'warning', message: `Target node ${action.targetNodeId} not found for property linking` }] };
            }
          }

          return { success: true, nodeId: compNode.id };
        }

        default:
          return { success: false, error: `Unknown action type: ${(action as any).action}` };
      }
    } catch (e: any) {
      return { success: false, error: e.message || 'Unknown error' };
    }
  }

  // --- Helpers ---

  private centerNodeInViewport(props: Record<string, any> | undefined, actionType: string): Record<string, any> {
    const p = props || {};
    if (p.x === undefined && p.y === undefined) {
      const defaultWidth = actionType === 'createText' ? 0 : 100;
      const defaultHeight = actionType === 'createText' ? 0 : 100;
      const w = p.width !== undefined ? p.width : defaultWidth;
      const h = p.height !== undefined ? p.height : defaultHeight;

      if (typeof figma !== 'undefined' && figma.viewport) {
        const vp = figma.viewport.bounds; // visible canvas area
        const vpCx = vp.x + vp.width / 2;
        const vpCy = vp.y + vp.height / 2;
        const GAP = 100;

        // First candidate: center of viewport
        const candX = Math.round(vpCx - w / 2);
        const candY = Math.round(vpCy - h / 2);

        // Check if viewport center area overlaps any existing top-level node
        const topChildren = figma.currentPage.children;
        const margin = GAP / 2;
        let overlaps = false;
        for (const child of topChildren) {
          if ('x' in child && 'width' in child && 'y' in child && 'height' in child) {
            const cx = (child as any).x, cy = (child as any).y;
            const cw = (child as any).width, ch = (child as any).height;
            if (candX < cx + cw + margin && candX + w > cx - margin &&
                candY < cy + ch + margin && candY + h > cy - margin) {
              overlaps = true;
              break;
            }
          }
        }

        if (!overlaps) {
          // Viewport center is free — place there
          p.x = candX;
          p.y = candY;
        } else {
          // Find rightmost edge among nodes currently visible in the viewport
          let maxRight = -Infinity;
          for (const child of topChildren) {
            if ('x' in child && 'width' in child && 'y' in child && 'height' in child) {
              const cy = (child as any).y, ch = (child as any).height;
              // Only nodes that vertically overlap the visible viewport
              if (cy < vp.y + vp.height && cy + ch > vp.y) {
                const right = (child as any).x + (child as any).width;
                if (right > maxRight) maxRight = right;
              }
            }
          }
          p.x = maxRight > -Infinity
            ? Math.round(maxRight + GAP)
            : Math.round(vp.x + vp.width + GAP); // nothing visible — place past viewport right edge
          p.y = Math.round(vpCy - h / 2);
        }
      }
    }
    return p;
  }

  /**
   * Pre-execution: normalize sizing props (HUG/FILL/FIXED) based on layout context.
   * Prevents Figma API exceptions like "HUG can only be set on auto-layout frames".
   *
   * @param isText — true for TEXT nodes. Text sizing is controlled by textAutoResize,
   *   so HUG→FIXED demotion and fallback dimensions are skipped.
   */
  private normalizeSizingInProps(
    props: Record<string, any>,
    targetNode: SceneNode | null,
    parentNode: SceneNode | null,
    isText?: boolean,
  ): Array<{ code: string; severity: 'warning'; message: string }> {
    if (props.layoutSizingHorizontal === undefined && props.layoutSizingVertical === undefined) {
      return [];
    }

    // TEXT nodes control sizing via textAutoResize, not layoutSizing*.
    // HUG→FIXED demotion and fallback dimensions would conflict with textAutoResize.
    if (isText) return [];

    const warnings: Array<{ code: string; severity: 'warning'; message: string }> = [];

    const nodeLayoutMode = props.layoutMode ?? (targetNode as any)?.layoutMode;
    const hasAutoLayout = nodeLayoutMode === 'HORIZONTAL' || nodeLayoutMode === 'VERTICAL';
    const parentLayoutMode =
      parentNode && 'layoutMode' in (parentNode as any)
        ? (parentNode as any).layoutMode
        : undefined;
    const parentHasAutoLayout = parentLayoutMode === 'HORIZONTAL' || parentLayoutMode === 'VERTICAL';
    const isRoot = !parentNode || (parentNode as any).type === 'PAGE';

    const toSizingMode = (v: unknown): SizingMode =>
      (v === 'HUG' || v === 'FILL' || v === 'FIXED') ? v : 'FIXED';

    const currentH = toSizingMode(
      props.layoutSizingHorizontal ?? (targetNode as any)?.layoutSizingHorizontal
    );
    const currentV = toSizingMode(
      props.layoutSizingVertical ?? (targetNode as any)?.layoutSizingVertical
    );

    const { h, v } = normalizeSizing(currentH, currentV, {
      hasAutoLayout,
      parentHasAutoLayout,
      isRoot,
    });

    if (props.layoutSizingHorizontal !== undefined) props.layoutSizingHorizontal = h;
    if (props.layoutSizingVertical !== undefined) props.layoutSizingVertical = v;

    if (h === 'FIXED' && currentH !== 'FIXED' && props.width === undefined) {
      const fallbackWidth = Math.max(
        1,
        Math.round(
          (targetNode as any)?.width ??
            ((parentNode as any)?.type !== 'PAGE' ? (parentNode as any)?.width : undefined) ??
            (isRoot ? 360 : 200)
        )
      );
      props.width = fallbackWidth;
      warnings.push({
        code: 'SIZING_NORMALIZED',
        severity: 'warning',
        message: `layoutSizingHorizontal ${currentH}→FIXED; width defaulted to ${fallbackWidth}px.`,
      });
    }

    if (v === 'FIXED' && currentV !== 'FIXED' && props.height === undefined) {
      const fallbackHeight = Math.max(
        1,
        Math.round(
          (targetNode as any)?.height ??
            ((parentNode as any)?.type !== 'PAGE' ? (parentNode as any)?.height : undefined) ??
            (isRoot ? 240 : 120)
        )
      );
      props.height = fallbackHeight;
      warnings.push({
        code: 'SIZING_NORMALIZED',
        severity: 'warning',
        message: `layoutSizingVertical ${currentV}→FIXED; height defaulted to ${fallbackHeight}px.`,
      });
    }

    return warnings;
  }

  /**
   * Upsert helper: find an existing child node matching name + type under parent.
   * Called only when action.upsertExisting=true.
   * Only matches when `name` is explicitly provided — unnamed nodes are always created fresh.
   */
  private findExistingChild(
    parent: SceneNode | null,
    name: string | undefined,
    expectedType: string,
  ): SceneNode | null {
    if (!parent || !name || !('children' in parent)) return null;
    const children = (parent as any).children as readonly SceneNode[];
    return children.find(
      (c: SceneNode) => c.name === name && c.type === expectedType
    ) ?? null;
  }

  /** Check if a node (or any ancestor) was created by the agent. */
  private isAgentOwned(node: SceneNode): boolean {
    let current: BaseNode | null = node;
    while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
      if ('getPluginData' in current && (current as SceneNode).getPluginData('_agent') === 'created') {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private resolveId(idOrTempId: string): string {
    return this.tempIdMap.get(idOrTempId) || idOrTempId;
  }

  private async resolveParent(parentId?: string): Promise<SceneNode | null> {
    if (!parentId || parentId === 'root') return null; // root or unspecified is conceptually null (handled by caller context if needed, but usually current selection or page active)
    const realId = this.resolveId(parentId);
    // asynchronously get node
    const node = await figma.getNodeByIdAsync(realId);
    return node as SceneNode | null;
  }

  private async resolveComponent(key?: string, nodeId?: string, variant?: string): Promise<ComponentNode | null> {
    if (key) {
      try {
        const comp = await figma.importComponentByKeyAsync(key);
        if (comp) return comp;
      } catch (e) {
        console.warn('Import component key failed', e);
      }
    }
    if (nodeId) {
      // Resolution chain: tempIdMap (current batch) → componentRegistry (cross-batch) → componentNameRegistry (name-based) → raw ID
      const resolvedId = this.resolveId(nodeId);
      const finalId = resolvedId !== nodeId
        ? resolvedId
        : (componentRegistry.get(nodeId) || componentNameRegistry.get(nodeId) || componentNameRegistry.get(toCamelCase(nodeId)) || nodeId);
      const node = await figma.getNodeByIdAsync(finalId);
      if (node && node.type === 'COMPONENT') return node as ComponentNode;
      if (node && node.type === 'COMPONENT_SET') {
        const cs = node as ComponentSetNode;
        if (variant) {
          // Exact match first, then partial match (variant string contained in component name)
          const exact = cs.children.find(c => c.type === 'COMPONENT' && c.name === variant);
          if (exact) return exact as ComponentNode;
          const partial = cs.children.find(c => c.type === 'COMPONENT' && c.name.includes(variant));
          if (partial) return partial as ComponentNode;
        }
        return cs.defaultVariant as ComponentNode;
      }
      // Fallback: search current page by name (handles name mismatch when LLM
      // overrides node name via name:'Variant=Default' but references by path name)
      const nameLower = nodeId.toLowerCase();
      const found = figma.currentPage.findOne(n =>
        (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') &&
        n.name.toLowerCase() === nameLower
      );
      if (found) {
        if (found.type === 'COMPONENT') return found as ComponentNode;
        if (found.type === 'COMPONENT_SET') {
          const cs = found as ComponentSetNode;
          if (variant) {
            const exact = cs.children.find(c => c.type === 'COMPONENT' && c.name === variant);
            if (exact) return exact as ComponentNode;
            const partial = cs.children.find(c => c.type === 'COMPONENT' && c.name.includes(variant));
            if (partial) return partial as ComponentNode;
          }
          return cs.defaultVariant as ComponentNode;
        }
      }
    }
    return null;
  }

  // Property ordering and dependency validation are derived from
  // propertyDependencies.ts — the single source of truth for Figma property prerequisites.

  private async applyProps(node: SceneNode, props: Record<string, any>): Promise<{ warnings: any[]; diffs: Array<{ key: string; changed: boolean; before?: any; after?: any }> }> {
    const warnings: any[] = [];
    const diffs: Array<{ key: string; changed: boolean; before?: any; after?: any }> = [];
    // 1. Expand shorthands (padding, align, fill, layout, etc.)
    const normalizedProps: Record<string, any> = expandShorthands({ ...props });

    // 2. Validate dependencies and auto-fix missing gates
    const nodeState: Record<string, unknown> = {};
    for (const g of SELF_GATE_PROPERTIES) {
      if (g in node) nodeState[g] = (node as any)[g];
    }
    let parentState: Record<string, unknown> | undefined;
    if (node.parent) {
      parentState = {};
      for (const g of PARENT_GATE_PROPERTIES) {
        if (g in node.parent) (parentState as any)[g] = (node.parent as any)[g];
      }
    }
    const { fixes, warnings: depWarnings } = validateDependencies(normalizedProps, nodeState, parentState);
    Object.assign(normalizedProps, fixes);
    for (const w of depWarnings) {
      warnings.push({ code: 'DEPENDENCY_VIOLATION', severity: 'warning', message: w });
    }

    // 3. Sort properties by dependency-derived order
    const sortedEntries = sortByPropertyOrder(Object.entries(normalizedProps));

    // 4. Apply each property via the handler pipeline
    for (const [key, value] of sortedEntries) {
      const result = await applyProperty(node, key, value);
      if (result.warnings.length > 0) warnings.push(...result.warnings);
      diffs.push(result.diff);
    }
    return { warnings, diffs };
  }

  private async applyTextProps(node: TextNode, props: Record<string, any>): Promise<{ warnings: any[]; diffs: Array<{ key: string; changed: boolean; before?: any; after?: any }> }> {
    const warnings: any[] = [];
    const diffs: Array<{ key: string; changed: boolean; before?: any; after?: any }> = [];

    // textAutoResize sync + align conversion are handled by normalizeProps() at parse time.
    // Single source of truth in node-normalizers.ts — no duplication here.

    // Handle font resolution before setting characters
    // Read current font from node as fallback — avoid resetting to Inter/Regular
    const currentFont = node.fontName as FontName;
    const family = props.fontFamily || currentFont?.family || 'Inter';

    // Resolve font weight → Figma style name
    const currentIsItalic = currentFont?.style?.includes('Italic') ?? false;
    const rawWeight = props.fontWeight ?? currentFont?.style?.replace(/\s*Italic\s*/, '').trim() ?? 'Regular';
    const weight = fontBus.normalizeWeight(rawWeight);

    // Resolve italic: explicit fontStyle prop > current node state
    const isItalic = props.fontStyle !== undefined
      ? props.fontStyle === 'italic'
      : currentIsItalic;

    // Build full style string: weight + italic
    const style = fontBus.buildStyleString(weight, isItalic);

    // Default font loading
    const { loadedStyle, error } = await fontBus.getOrLoad(family, style);
    if (error && loadedStyle !== style) {
       warnings.push({
           code: 'FONT_FALLBACK',
           severity: 'warning',
           requested: { family, style },
           applied: { family, style: loadedStyle },
           message: `Font not found, applied fallback: ${loadedStyle}`
       });
    }

    node.fontName = { family, style: loadedStyle };

    // Parse rich text markup (markdown → plain text + ranges)
    if (props.characters !== undefined) {
       const { plainText, ranges } = parseRichText(props.characters);
       node.characters = plainText;

       // Apply base props BEFORE range overrides so node-level fills/fontSize
       // don't clobber range-specific setRangeFills/setRangeFontSize calls.
       const otherProps = { ...props };
       delete otherProps.fontFamily;
       delete otherProps.fontWeight;
       delete otherProps.fontStyle;
       delete otherProps.fontSlant;
       delete otherProps.characters;

       const propResult = await this.applyProps(node, otherProps);
       if (propResult.warnings.length > 0) warnings.push(...propResult.warnings);
       diffs.push(...propResult.diffs);

       // Apply style ranges via Figma Range API (after base props)
       for (const range of ranges) {
         try {
           await this.applyStyledRange(node, range, family);
         } catch (e: any) {
           warnings.push({
             code: 'RANGE_STYLE_FAILED',
             severity: 'warning',
             message: `Failed to apply ${range.style.type} at [${range.start}:${range.end}]: ${e?.message}`,
           });
         }
       }
    } else {
       const otherProps = { ...props };
       delete otherProps.fontFamily;
       delete otherProps.fontWeight;
       delete otherProps.fontStyle;
       delete otherProps.fontSlant;

       const propResult = await this.applyProps(node, otherProps);
       if (propResult.warnings.length > 0) warnings.push(...propResult.warnings);
       diffs.push(...propResult.diffs);
    }

    return { warnings, diffs };
  }

  /** Apply a single styled range to a TextNode using Figma Range API. */
  private async applyStyledRange(
    node: TextNode,
    range: import('../text/richTextParser').StyledRange,
    baseFamily: string,
  ): Promise<void> {
    const { start, end, style } = range;

    switch (style.type) {
      case 'bold': {
        const { loadedStyle } = await fontBus.getOrLoad(baseFamily, 'Bold');
        node.setRangeFontName(start, end, { family: baseFamily, style: loadedStyle });
        break;
      }
      case 'italic': {
        const { loadedStyle } = await fontBus.getOrLoad(baseFamily, 'Italic');
        node.setRangeFontName(start, end, { family: baseFamily, style: loadedStyle });
        break;
      }
      case 'boldItalic': {
        const { loadedStyle } = await fontBus.getOrLoad(baseFamily, 'Bold Italic');
        node.setRangeFontName(start, end, { family: baseFamily, style: loadedStyle });
        break;
      }
      case 'strikethrough':
        node.setRangeTextDecoration(start, end, 'STRIKETHROUGH' as TextDecoration);
        break;
      case 'color': {
        const hex = style.value.replace('#', '');
        const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
        const color = {
          r: parseInt(full.substring(0, 2), 16) / 255,
          g: parseInt(full.substring(2, 4), 16) / 255,
          b: parseInt(full.substring(4, 6), 16) / 255,
        };
        node.setRangeFills(start, end, [{ type: 'SOLID', color }]);
        break;
      }
      case 'size':
        node.setRangeFontSize(start, end, style.value);
        break;
    }
  }

  // --- Transactions ---

  private async rollbackIfNeeded(hasFailures: boolean, globalOnError: string) {
    const summary = {
      attempted: 0,
      removed: 0,
      failed: [] as Array<{ opId: string; nodeId: string; reason: string }>
    };

    if (!hasFailures || globalOnError !== 'abort') {
      return summary;
    }

    summary.attempted = this.rollbackStack.length;

    for (const ref of [...this.rollbackStack].reverse()) {
      try {
        const node = await figma.getNodeByIdAsync(ref.nodeId) as SceneNode | null;
        if (node && !node.removed) {
          node.remove();
          summary.removed++;
        }
      } catch (e: any) {
        summary.failed.push({
          opId: ref.tempId,
          nodeId: ref.nodeId,
          reason: e?.message || 'Unknown rollback error'
        });
      }
    }

    return summary;
  }

  private topologicalSort(actions: FigmaAction[]): FigmaAction[] {
    // Actions without tempId (e.g. updateProps) have no dependency graph —
    // topological sort is meaningless for them. Pass through in order.
    const hasDeps = actions.some(a => a.tempId);
    if (!hasDeps) return actions;

    const sorted: FigmaAction[] = [];
    const visited = new Set<string>();
    const processing = new Set<string>();

    const actionMap = new Map<string, FigmaAction>();
    for (const action of actions) {
      if (action.tempId) {
        actionMap.set(action.tempId, action);
      }
    }

    const visit = (action: FigmaAction) => {
      const id = action.tempId;
      if (!id) {
        // No tempId = no dependency tracking. Just push in encounter order.
        sorted.push(action);
        return;
      }
      if (visited.has(id)) return;
      if (processing.has(id)) {
        console.warn('Circular dependency detected in batch operations');
        return;
      }

      processing.add(id);

      if (action.dependsOn) {
        for (const dep of action.dependsOn) {
          const depAction = actionMap.get(dep);
          if (depAction) visit(depAction);
        }
      }

      processing.delete(id);
      visited.add(id);
      sorted.push(action);
    };

    for (const action of actions) {
      visit(action);
    }

    return sorted;
  }
}
