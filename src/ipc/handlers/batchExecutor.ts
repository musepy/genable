/**
 * @file batchExecutor.ts
 * @description Extracted batch operation orchestrator.
 *
 * Manages the state machine for batch operations:
 * - opId → nodeId mapping (idMap)
 * - Dependency tracking and skip logic
 * - Duplicate detection
 * - Rollback on partial failure
 * - Post-execution snapshots
 *
 * The actual per-action execution is delegated to an `executeAction` callback
 * provided by the caller (toolCallHandler), keeping Figma API calls in one place.
 */

import { completeStep } from '../helpers/idempotentApply';

// ==========================================
// Types
// ==========================================

export interface BatchOperation {
  opId?: string;
  action?: string;
  params?: any;
  dependsOn?: string[];
}

export type OutputPolicy = 'DETAILED' | 'DISTILLED' | 'SILENT';

export interface BatchOptions {
  stepId?: string;
  outputPolicy?: OutputPolicy;
}

export interface BatchOpResult {
  opId?: string;
  action?: string;
  success: boolean;
  nodeId?: string;
  name?: string;
  error?: { code: string; message: string };
  skipped?: boolean;
  children?: BatchOpResult[];
  [key: string]: any;
}

export interface BatchExecutorDeps {
  /** Set of allowed action names */
  allowedActions: Set<string>;
  /** Error handling strategy */
  onError: 'skip-dependents' | 'abort';
  /**
   * Execute a single action. Receives the resolved params (with nodeId/parentId
   * already resolved from refs via idMap). Returns the operation result.
   */
  executeAction: (
    action: string,
    params: any,
    context: ActionContext
  ) => Promise<BatchOpResult>;
  /** Validate preconditions before execution */
  validatePreconditions: (action: string, params: any) => Promise<{ valid: boolean; error?: string }>;
  /** Capture post-execution snapshot of a node */
  captureSnapshot?: (nodeId: string) => Promise<any>;
  /** Perform diff check on a node */
  performDiff?: (opId: string, action: string, params: any, nodeId: string) => Promise<{ diff?: any[]; diffInfo?: string[] }>;
}

export interface ActionContext {
  idMap: Record<string, string>;
  registerNode: (opId: string, nodeId: string) => void;
  registerCreated: (opId: string, nodeId: string) => void;
  /** Execute a child operation (for recursive children support) */
  executeChild: (operation: BatchOperation) => Promise<BatchOpResult>;
}

export interface BatchResult {
  success: boolean;
  data: {
    results: BatchOpResult[];
    idMap: Record<string, string>;
    layoutSnapshots: Record<string, any>;
    rollback?: { attempted: number; removed: number; failed: Array<{ opId: string; nodeId: string; reason: string }> };
  };
  error?: { code: string; message: string };
}

// ==========================================
// Ref Resolution Helpers
// ==========================================

export function resolveNodeId(
  params: any,
  idMap: Record<string, string>
): { nodeId?: string; error?: { code: string; message: string } } {
  if (params?.nodeId) return { nodeId: params.nodeId };
  if (params?.nodeRef) {
    const nodeId = idMap[params.nodeRef];
    if (!nodeId) {
      return { error: { code: 'MISSING_REF', message: `nodeRef '${params.nodeRef}' could not be resolved to a nodeId.` } };
    }
    return { nodeId };
  }
  return { error: { code: 'MISSING_REF', message: 'nodeId or nodeRef is required.' } };
}

export function resolveParentId(
  params: any,
  idMap: Record<string, string>
): { parentId?: string; error?: { code: string; message: string } } {
  if (params?.parentId) return { parentId: params.parentId };
  if (!params?.parentRef || params.parentRef === 'root') return { parentId: undefined };
  const parentId = idMap[params.parentRef];
  if (!parentId) {
    return { error: { code: 'MISSING_REF', message: `parentRef '${params.parentRef}' could not be resolved to a nodeId.` } };
  }
  return { parentId };
}

// ==========================================
// BatchExecutor
// ==========================================

export class BatchExecutor {
  private idMap: Record<string, string> = {};
  private opStatus = new Map<string, { success: boolean; error?: { code: string; message: string } }>();
  private seenOpIds = new Set<string>();
  private createdNodeRefs: Array<{ opId: string; nodeId: string }> = [];
  private results: BatchOpResult[] = [];

  constructor(private deps: BatchExecutorDeps) {}

  async execute(operations: BatchOperation[], options: BatchOptions = {}): Promise<BatchResult> {
    const { stepId, outputPolicy = 'DETAILED' } = options;
    for (const operation of operations) {
      await this.executeSingleOperation(operation);
    }

    const hasFailures = this.results.some(r => !r.success);

    // Rollback created nodes on partial failure
    const rollbackResult = await this.rollbackIfNeeded(hasFailures);

    // Capture layout snapshots for surviving nodes (unless policy is SILENT or DISTILLED)
    const layoutSnapshots = (outputPolicy === 'DETAILED') 
      ? await this.captureSnapshots()
      : {};

    if (!hasFailures && stepId) {
      completeStep(stepId);
    }

    return hasFailures
      ? {
          success: false,
          data: {
            results: this.results,
            idMap: this.idMap,
            layoutSnapshots,
            ...(rollbackResult ? { rollback: rollbackResult } : undefined)
          },
          error: { code: 'PARTIAL_FAILURE', message: 'One or more operations failed.' }
        }
      : { success: true, data: { results: this.results, idMap: this.idMap, layoutSnapshots } };
  }

  private async executeSingleOperation(operation: BatchOperation): Promise<BatchOpResult> {
    const opId = operation?.opId;
    const action = operation?.action;
    const params = operation?.params || {};

    // Validate opId
    if (!opId || typeof opId !== 'string') {
      const result: BatchOpResult = {
        opId, action, success: false,
        error: { code: 'INVALID_OPERATION', message: 'opId is required for each operation.' }
      };
      this.recordResult(opId, result);
      return result;
    }

    // Duplicate detection
    if (this.seenOpIds.has(opId)) {
      const result: BatchOpResult = {
        opId, action, success: false,
        error: { code: 'INVALID_OPERATION', message: `Duplicate opId '${opId}' in batch.` }
      };
      this.recordResult(opId, result);
      return result;
    }
    this.seenOpIds.add(opId);

    // Validate action
    if (!action || typeof action !== 'string' || !this.deps.allowedActions.has(action)) {
      const result: BatchOpResult = {
        opId, action, success: false,
        error: { code: 'INVALID_ACTION', message: `Unsupported action '${action}'.` }
      };
      this.recordResult(opId, result);
      return result;
    }

    // Dependency resolution
    const depIds = this.collectDependencies(operation);
    const dependencyIssue = this.checkDependencies(depIds);
    if (dependencyIssue) {
      const result: BatchOpResult = {
        opId, action, success: false,
        skipped: this.deps.onError === 'skip-dependents',
        error: dependencyIssue
      };
      this.recordResult(opId, result);
      return result;
    }

    // Precondition validation
    const resolvedNodeId = resolveNodeId(params, this.idMap).nodeId;
    const validation = await this.deps.validatePreconditions(action, { ...params, nodeId: resolvedNodeId });
    if (!validation.valid) {
      console.warn(`[batchOps] ❌ Precondition failed for op '${opId}': ${validation.error}`);
      const result: BatchOpResult = {
        opId, action, success: false,
        error: { code: 'PRECONDITION_FAILED', message: validation.error || 'Precondition check failed.' }
      };
      this.recordResult(opId, result);
      return result;
    }

    // Execute the action via callback
    let opResult: BatchOpResult;
    try {
      const actionContext: ActionContext = {
        idMap: this.idMap,
        registerNode: (id, nodeId) => { this.idMap[id] = nodeId; },
        registerCreated: (id, nodeId) => {
          this.idMap[id] = nodeId;
          this.createdNodeRefs.push({ opId: id, nodeId });
          this.opStatus.set(id, { success: true });
        },
        executeChild: (childOp) => this.executeSingleOperation(childOp),
      };

      opResult = await this.deps.executeAction(action, { ...params, _opId: opId }, actionContext);
      opResult.opId = opId;
      opResult.action = action;
    } catch (e: any) {
      opResult = {
        opId, action, success: false,
        error: { code: 'APPLY_ERROR', message: e.message }
      };
    }

    // Post-success bookkeeping
    if (opResult.success && opResult.nodeId && action !== 'deleteNode') {
      if (!this.idMap[opId]) this.idMap[opId] = opResult.nodeId;
    }

    if (opResult.success && params?.stepId) {
      completeStep(params.stepId);
    }

    // Diff check
    if (opResult.success && opResult.nodeId && this.deps.performDiff &&
        (action === 'setNodeLayout' || action === 'applyDesignPatch')) {
      try {
        const diff = await this.deps.performDiff(opId, action, params, opResult.nodeId);
        if (diff.diff) opResult.diff = diff.diff;
        if (diff.diffInfo) opResult.diffInfo = diff.diffInfo;
      } catch (e) {
        console.warn(`[batchOps] Failed to perform diff check for op '${opId}':`, e);
      }
    }

    this.recordResult(opId, opResult);
    return opResult;
  }

  private recordResult(opId: string | undefined, result: BatchOpResult): void {
    this.results.push(result);
    if (opId) {
      this.opStatus.set(opId, { success: result.success, error: result.error });
    }
  }

  private collectDependencies(operation: BatchOperation): Set<string> {
    const deps = new Set<string>();
    const params = operation.params || {};
    const action = operation.action;

    if (Array.isArray(operation.dependsOn)) {
      for (const dep of operation.dependsOn) {
        if (typeof dep === 'string') deps.add(dep);
      }
    }

    if (action === 'createNode' || action === 'createIcon') {
      this.addRefDependency(deps, params.parentRef);
    } else if (action === 'applyDesignPatch') {
      const patches = Array.isArray(params.patches) ? params.patches : [];
      for (const patch of patches) {
        this.addRefDependency(deps, patch?.nodeRef);
      }
    } else {
      this.addRefDependency(deps, params.nodeRef);
    }

    return deps;
  }

  private addRefDependency(deps: Set<string>, ref: any): void {
    if (typeof ref === 'string' && ref !== 'root') {
      deps.add(ref);
    }
  }

  private checkDependencies(deps: Set<string>): { code: string; message: string } | null {
    for (const depId of deps) {
      const status = this.opStatus.get(depId);
      if (!status) {
        return {
          code: this.deps.onError === 'skip-dependents' ? 'DEPENDENCY_SKIP' : 'MISSING_REF',
          message: `Dependency '${depId}' was not executed before this operation.`
        };
      }
      if (!status.success) {
        const detail = status.error?.message ? ` ${status.error.message}` : '';
        return {
          code: this.deps.onError === 'skip-dependents' ? 'DEPENDENCY_SKIP' : 'MISSING_REF',
          message: `Dependency '${depId}' failed.${detail}`
        };
      }
    }
    return null;
  }

  private async rollbackIfNeeded(hasFailures: boolean) {
    if (!hasFailures || this.deps.onError !== 'skip-dependents' || this.createdNodeRefs.length === 0) {
      return undefined;
    }

    const rollback = {
      attempted: 0,
      removed: 0,
      failed: [] as Array<{ opId: string; nodeId: string; reason: string }>
    };

    for (const ref of [...this.createdNodeRefs].reverse()) {
      rollback.attempted++;
      try {
        const node = await figma.getNodeByIdAsync(ref.nodeId) as SceneNode | null;
        if (node && !node.removed) {
          node.remove();
          rollback.removed++;
        }
      } catch (e: any) {
        rollback.failed.push({
          opId: ref.opId,
          nodeId: ref.nodeId,
          reason: e?.message || 'Unknown rollback error'
        });
      } finally {
        delete this.idMap[ref.opId];
      }
    }

    return rollback;
  }

  private async captureSnapshots(): Promise<Record<string, any>> {
    if (!this.deps.captureSnapshot) return {};
    const snapshots: Record<string, any> = {};
    for (const [opId, nodeId] of Object.entries(this.idMap)) {
      try {
        const snapshot = await this.deps.captureSnapshot(nodeId);
        if (snapshot) snapshots[opId] = snapshot;
      } catch (e) {
        console.warn(`[BatchExecutor] Failed to capture snapshot for ${opId} (${nodeId})`, e);
      }
    }
    return snapshots;
  }
}
