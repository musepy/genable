/**
 * @file toolCallHandler.ts
 * @description IPC handler for TOOL_CALL events.
 * 
 * [RESPONSIBILITY]: Route tool calls to appropriate services.
 * [PATTERN]: Command Handler - thin layer that delegates to services.
 */

import { ToolResultHandler } from '../../types';
import { nodeLayoutService } from '../../engine/services';
import { agentToolService } from '../../engine/services';
import { ToolResponse, ToolContext } from '../../engine/agent/tools/types';
import { emit } from '@create-figma-plugin/utilities';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { handleUnifiedRender } from '../helpers/renderHelper';

import { validateVisibility } from '../../engine/validation/visibilityValidator';
import { patchCache } from '../../engine/validation/patchCache';
import { TreeReconstructor } from '../../engine/figma-adapter/treeReconstructor';
import { diffIntendedVsActual } from '../../engine/validation/mutationDiff';

import {
  BatchExecutor,
  BatchOpResult,
  ActionContext,
  resolveNodeId as batchResolveNodeId,
  resolveParentId as batchResolveParentId
} from './batchExecutor';
import { ActionExecutor } from '../../engine/actions/executor';
import { FigmaAction } from '../../engine/actions/types';
import { translateBatchOperationsToActions } from '../../engine/actions/translator';
import { deepMerge } from '../../utils/objectUtils';
import { validatePostOp, collectTreeAnomalies } from '../../engine/validation/postOpValidator';
import { logger } from '../../utils/logger';

export interface ToolCallData {
  toolName: string;
  parameters: any;
  context?: ToolContext;
  requestId: string;
}

/** Properties that flatProps CANNOT override (safety-critical mappings) */
const PROTECTED_KEYS = new Set(['type']);

function sanitizeFlatProps(flatProps: Record<string, any> | undefined): Record<string, any> {
  if (!flatProps) return {};
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(flatProps)) {
    if (PROTECTED_KEYS.has(key)) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Handle TOOL_CALL IPC events.
 * This is a thin wrapper that delegates to services.
 */
export async function handleToolCall(data: ToolCallData): Promise<void> {
  let { toolName, parameters, context, requestId } = data;
  
  // Tool Name Normalization (Handle LLM Typos/Hallucinations)
  const normalizedName = toolName.replace(/-([a-z])/g, (g: string) => g[1].toUpperCase());
  if (normalizedName !== toolName) {
    logger.info(`Normalizing tool name: ${toolName} -> ${normalizedName}`);
    toolName = normalizedName;
  }

  logger.info(`Tool Call: ${toolName}`, { parameters, requestId });

  let response: ToolResponse;

  try {
    switch (toolName) {
      // ==========================================
      // BATCH OPERATIONS — Legacy-compatible bulk execution path
      // ==========================================
      case 'batchOperations': {
        const { operations, onError = 'skip-dependents' } = parameters || {};

        if (!Array.isArray(operations)) {
          response = {
            success: false,
            error: { code: 'INVALID_OPERATION', message: 'operations must be an array.' }
          };
          break;
        }

        const SHADOW_RUN_TYPED_ACTIONS = parameters?.useTypedExecutor === true;

        if (SHADOW_RUN_TYPED_ACTIONS) {
          try {
            const figmaActions = translateBatchOperationsToActions(operations);
            const executor = new ActionExecutor({ onError });
            const execResult = await executor.execute(figmaActions);
            
            const results: BatchOpResult[] = execResult.results.map(r => ({
              opId: r.action.tempId || 'unknown',
              action: r.action.action,
              success: r.success,
              nodeId: r.nodeId,
              skipped: r.skipped,
              error: r.error ? { code: 'EXECUTION_ERROR', message: r.error } : undefined
            }));

            response = {
              success: execResult.success,
              data: {
                results,
                idMap: execResult.idMap,
                layoutSnapshots: {},
                rollback: execResult.rollback
              }
            };
          } catch (error: any) {
            response = {
              success: false,
              error: { code: 'EXECUTION_ERROR', message: error.message || 'Unknown error during translation or execution' }
            };
          }
          break;
        }

        const executor = new BatchExecutor({
          allowedActions: new Set([
            'createNode', 'setNodeLayout', 'setNodeStyles',
            'updateNodeProperties', 'createIcon', 'deleteNode', 'applyDesignPatch',
            'renderSubtree', 'patchNode'
          ]),
          onError,
          executeAction: (action, params, ctx) =>
            executeBatchAction(action, params, ctx, context),
          validatePreconditions,
          captureSnapshot: async (nodeId) => {
            const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
            return node ? NodeSerializer.serialize(node) : undefined;
          },
          performDiff: async (opId, action, params, nodeId) => {
            const finalNode = await figma.getNodeByIdAsync(nodeId);
            if (!finalNode) return {};
            const serialized = NodeSerializer.serialize(finalNode as SceneNode);
            const diff = diffIntendedVsActual(params, serialized);
            if (!diff.hasDiscrepancy) return {};
            console.log(`[batchOps] 🔍 Diff detected for op '${opId}':`, diff.messages);
            return {
              diff: diff.actionable.length > 0 ? diff.actionable : undefined,
              diffInfo: diff.informational.length > 0
                ? diff.informational.map((msg: string) => `[Auto-corrected] ${msg}`)
                : undefined
            };
          }
        });

        response = await executor.execute(operations, { 
          stepId: parameters.stepId, 
          outputPolicy: 'DISTILLED' 
        });
        break;
      }

      // ==========================================
      // UNIFIED TOOLS — New 7-primitive API
      // These delegate to existing implementations.
      // ==========================================

      case 'read_node': {
        const { mode: readMode, nodeId: readNodeId, depth: readDepth } = parameters;

        switch (readMode) {
          case 'selection': {
            const selection = nodeLayoutService.getSelection();
            response = { success: true, data: selection };
            break;
          }
          case 'hierarchy': {
            const hNode = await figma.getNodeByIdAsync(readNodeId) as SceneNode;
            if (!hNode) {
              response = { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${readNodeId} not found.` } };
              break;
            }
            const hSerialized = NodeSerializer.serializeWithCompression(hNode, {
              maxDepth: Math.min(readDepth || 5, 10),
              pruneDefaults: false
            });
            const anomalies = collectTreeAnomalies(hNode, Math.min(readDepth || 5, 10));
            response = {
              success: true,
              data: {
                ...hSerialized,
                anomalies: anomalies.length > 0 ? anomalies : undefined
              }
            };
            break;
          }
          case 'node': {
            const nNode = await figma.getNodeByIdAsync(readNodeId) as SceneNode;
            if (!nNode) {
              response = { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${readNodeId} not found.` } };
              break;
            }
            const nSerialized = NodeSerializer.serialize(nNode);
            response = { success: true, data: nSerialized };
            break;
          }
          case 'variables': {
            // Use Figma API to get local variables
            const localVars = typeof figma !== 'undefined' && figma.variables
              ? await figma.variables.getLocalVariablesAsync()
              : [];
            const varsSerialized = localVars.map((v: any) => ({
              id: v.id,
              name: v.name,
              resolvedType: v.resolvedType,
            }));
            response = { success: true, data: varsSerialized };
            break;
          }
          case 'styles': {
            const localStyles = await figma.getLocalPaintStylesAsync();
            const stylesSerialized = localStyles.map(s => ({
              id: s.id,
              name: s.name,
              paints: s.paints
            }));
            response = { success: true, data: stylesSerialized };
            break;
          }
          default:
            response = { success: false, error: { code: 'INVALID_MODE', message: `read_node mode '${readMode}' is not valid. Use 'selection', 'hierarchy', 'node', 'variables', or 'styles'.` } };
        }
        break;
      }

      case 'create_node': {
        const { nodes, parentId } = parameters;

        const createActions = nodes.map((node: any) => {
           let actionType = '';
           switch(node.type) {
             case 'FRAME': actionType = 'createFrame'; break;
             case 'TEXT': actionType = 'createText'; break;
             case 'ICON': actionType = 'createIcon'; break;
             case 'RECTANGLE': 
             case 'ELLIPSE':
             case 'LINE':
                actionType = 'createShape';
                break;
             default: actionType = 'createFrame'; break;
           }
           
           const action: any = {
              action: actionType,
              tempId: node.id,
              parentId: node.parent || parentId,
              props: node.props || {}
           };
           
           if (actionType === 'createShape') {
              action.shapeType = node.type;
           }
           
           if (node.parent) {
             action.dependsOn = [node.parent];
           }
           
           return action;
        });

        const executor = new ActionExecutor({ onError: 'skip-dependents' });
        const execResult = await executor.execute(createActions);
        
        const failedResults = execResult.results.filter(r => !r.success);

        const allWarnings: any[] = [];
        execResult.results.forEach(r => {
           if (r.warnings && r.warnings.length > 0) {
               r.warnings.forEach((w: any) => {
                   allWarnings.push({
                       ...w,
                       tempId: r.action.tempId,
                       nodeId: r.nodeId
                   });
               });
           }
        });

        if (!execResult.success && failedResults.length > 0) {
          const firstFailure = failedResults[0];
          response = {
             success: false,
             error: { 
               code: 'ACTION_FAILED', 
               message: `Failed to create nodes: ${firstFailure.error}. subCategory: ${firstFailure.errorContext?.subCategory || 'UNKNOWN'}, retryTried: ${firstFailure.errorContext?.retryTried || false}. See data.firstFailure for details.` 
             },
             data: {
               results: execResult.results,
               idMap: execResult.idMap,
               firstFailure: {
                 tempId: firstFailure.action.tempId,
                 action: firstFailure.action.action,
                 error: firstFailure.error,
                 subCategory: firstFailure.errorContext?.subCategory || 'UNKNOWN',
                 failedNodeId: firstFailure.errorContext?.failedNodeId || firstFailure.action.tempId,
                 retryTried: firstFailure.errorContext?.retryTried || false
               },
               failureCount: failedResults.length,
               failureActionIds: failedResults.map(r => r.action.tempId),
               warnings: allWarnings.length > 0 ? allWarnings : undefined
             }
          };

          const propsPreview = 'props' in firstFailure.action && firstFailure.action.props ? JSON.stringify(firstFailure.action.props).substring(0, 150) + '...' : undefined;
          logger.error(`[create_node] Execution failed`, {
             requestId,
             failureCount: failedResults.length,
             firstFailure: {
                action: firstFailure.action.action,
                tempId: 'tempId' in firstFailure.action ? firstFailure.action.tempId : undefined,
                error: firstFailure.error,
                subCategory: firstFailure.errorContext?.subCategory || 'UNKNOWN',
                failedNodeId: firstFailure.errorContext?.failedNodeId || firstFailure.action.tempId,
                retryTried: firstFailure.errorContext?.retryTried || false
             },
             normalizedPropsPreview: propsPreview,
             errorCategory: 'CREATE_NODE_BATCH_FAILURE'
          });
        } else {
          response = {
             success: execResult.success,
             data: {
               results: execResult.results,
               idMap: execResult.idMap,
               warnings: allWarnings.length > 0 ? allWarnings : undefined
             }
          };
        }
        break;
      }

      case 'patch_node': {
        const { patches, stepId: _patchStepId } = parameters;

        const patchActions: FigmaAction[] = patches.map((patch: any) => ({
          action: 'updateProps' as const,
          nodeId: patch.nodeId,
          props: patch.props || {}
        }));

        const executor = new ActionExecutor({ onError: 'skip-dependents' });
        const execResult = await executor.execute(patchActions);

        const failedResults = execResult.results.filter(r => !r.success);

        const allWarnings: any[] = [];
        execResult.results.forEach(r => {
           if (r.warnings && r.warnings.length > 0) {
               r.warnings.forEach((w: any) => {
                   allWarnings.push({
                       ...w,
                       nodeId: r.nodeId || ('nodeId' in r.action ? r.action.nodeId : undefined)
                   });
               });
           }
        });

        if (!execResult.success && failedResults.length > 0) {
          const firstFailure = failedResults[0];
          const errorContext = firstFailure.errorContext;
          const retryTried = errorContext ? errorContext.retryTried : false;
          const subCategory = errorContext ? errorContext.subCategory : 'UNKNOWN';
          const failedNodeId = firstFailure.nodeId || ('nodeId' in firstFailure.action ? firstFailure.action.nodeId : undefined);

          response = {
            success: false,
            error: {
              code: 'ACTION_FAILED',
              message: `Failed to patch nodes: ${firstFailure.error}. subCategory: ${subCategory}, retryTried: ${retryTried}. See data.firstFailure for details.`
            },
            data: {
              results: execResult.results,
              firstFailure: {
                nodeId: failedNodeId,
                action: firstFailure.action.action,
                error: firstFailure.error,
                subCategory,
                failedNodeId: errorContext?.failedNodeId || failedNodeId,
                retryTried
              },
              failureCount: failedResults.length,
              failureActionIds: failedResults.map(r => r.nodeId || ('nodeId' in r.action ? r.action.nodeId : undefined)),
              warnings: allWarnings.length > 0 ? allWarnings : undefined
            }
          };
        } else {
          response = {
            success: execResult.success,
            data: {
              results: execResult.results,
              warnings: allWarnings.length > 0 ? allWarnings : undefined
            }
          };
        }
        break;
      }

      case 'delete_node': {
        response = await nodeLayoutService.deleteNode(parameters.nodeId);
        break;
      }

      case 'validate_design': {
        const valNodeId = parameters.nodeId;
        const valNode = await figma.getNodeByIdAsync(valNodeId) as SceneNode;
        if (!valNode) {
          response = { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${valNodeId} not found.` } };
          break;
        }
        const valResult = validatePostOp(valNode, {});
        const anomalyResult = collectTreeAnomalies(valNode, 5);
        response = {
          success: true,
          data: {
            valid: valResult.length === 0 && anomalyResult.length === 0,
            issues: valResult.length > 0 ? valResult : undefined,
            anomalies: anomalyResult.length > 0 ? anomalyResult : undefined
          }
        };
        break;
      }

      // ==========================================
      // DEFAULT — Unknown Tool
      // ==========================================
      default:
        response = {
          success: false,
          error: { code: 'UNKNOWN_TOOL', message: `Tool '${toolName}' not found in main registry.` }
        };
        break;
    }
  } catch (e: any) {
    console.error(`[Agent] Tool Execution Error (${toolName}):`, e);
    response = {
      success: false,
      error: { code: 'EXECUTION_ERROR', message: e.message }
    };
  }

  emit<ToolResultHandler>('TOOL_RESULT', { requestId, response: response! });
}

/**
 * Execute a single batch action. Delegates Figma API calls for each action type.
 * Used as the `executeAction` callback for BatchExecutor.
 */
async function executeBatchAction(
  action: string,
  params: any,
  ctx: ActionContext,
  toolContext?: ToolContext
): Promise<BatchOpResult> {
  switch (action) {
    case 'createNode': {
      const { type, name, characters, children, props: flatProps } = params;
      if (!type) {
        return { success: false, error: { code: 'INVALID_OPERATION', message: 'createNode requires type.' } };
      }

      const parentResolution = batchResolveParentId(params, ctx.idMap);
      if (parentResolution.error) {
        return { success: false, error: parentResolution.error };
      }

      const explicitParent = await nodeLayoutService.resolveParent(parentResolution.parentId);
      if (!explicitParent && parentResolution.parentId) {
        return {
          success: false,
          error: {
            code: 'PARENT_NOT_FOUND',
            message: `Parent '${parentResolution.parentId}' not found. Aborting createNode to prevent page-root leakage.`
          }
        };
      } else if (!explicitParent && !params.parentRef && !params.parentId) {
        console.warn(`[batchOps] ⚠️ No parent specified for '${name || type}' - node placed at page root`);
      }

      const node = await handleUnifiedRender({
        type,
        props: {
          name: name || 'unnamed',
          characters: characters || '',
          ...sanitizeFlatProps(flatProps)
        },
        designSystemId: toolContext?.designSystemId || 'vanilla',
        streamSessionId: `agent-batch-${Date.now()}`,
        meta: { traceId: 'agent-batch-tool' }
      }, false, explicitParent);

      if (!node) {
        return { success: false, error: { code: 'APPLY_ERROR', message: 'Failed to create node.' } };
      }

      // Register in idMap via callback
      ctx.registerCreated(params._opId || '', node.id);

      if (params.layout) await nodeLayoutService.applyLayout(node.id, params.layout);
      if (params.styles) await nodeLayoutService.applyStyles(node.id, params.styles);

      const visResult = validateVisibility(node);
      if (!visResult.valid) {
        visResult.issues.filter(i => i.severity === 'error').forEach(i => i.autoFix?.());
      }

      // Process inline children
      const childResults: BatchOpResult[] = [];
      if (Array.isArray(children)) {
        for (const childOp of children) {
          const childParams = childOp.params || {};
          const hasExplicitParent = childParams.parentRef || childParams.parentId;
          const childResult = await ctx.executeChild({
            ...childOp,
            params: {
              ...childParams,
              ...(!hasExplicitParent && { parentRef: params._opId })
            }
          });
          childResults.push(childResult);
        }
      }

      // Post-op anomaly detection
      const batchAnomalies = validatePostOp(node, sanitizeFlatProps(flatProps));

        return {
        success: true,
        nodeId: node.id,
        name: node.name,
        children: childResults.length > 0 ? childResults : undefined,
        visibilityWarnings: visResult.issues.filter(i => i.severity === 'warning').length > 0
          ? visResult.issues.filter(i => i.severity === 'warning')
          : undefined,
        visibilityAutoFixed: visResult.autoFixed.length > 0 ? visResult.autoFixed : undefined,
        anomalies: batchAnomalies.length > 0 ? batchAnomalies : undefined
      };
    }

    case 'renderSubtree': {
      const { nodes } = params;
      if (!Array.isArray(nodes) || nodes.length === 0) {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'renderSubtree requires non-empty nodes array.' } };
      }

      // Reconstruct flat list -> tree
      const reconstructor = new TreeReconstructor();
      const { root, errors, warnings } = reconstructor.reconstruct(nodes);

      if (!root) {
        return { success: false, error: { code: 'RECONSTRUCTION_FAILED', message: errors.join('; ') } };
      }

      const parentResolution = batchResolveParentId(params, ctx.idMap);
      if (parentResolution.error) {
        return { success: false, error: parentResolution.error };
      }

      const explicitParent = await nodeLayoutService.resolveParent(parentResolution.parentId);

      const node = await handleUnifiedRender({
        ...root,
        designSystemId: toolContext?.designSystemId || 'vanilla',
        streamSessionId: `agent-batch-subtree-${Date.now()}`,
        meta: { traceId: 'agent-batch-tool' }
      }, false, explicitParent);

      if (!node) {
        return { success: false, error: { code: 'APPLY_ERROR', message: 'Failed to render subtree.' } };
      }

      ctx.registerCreated(params._opId || '', node.id);

      const visResult = validateVisibility(node);
      if (!visResult.valid) {
        visResult.issues.filter(i => i.severity === 'error').forEach(i => i.autoFix?.());
      }

      return {
        success: true,
        nodeId: node.id,
        name: node.name,
        type: node.type,
        warnings: warnings.length > 0 ? warnings : undefined,
        visibilityWarnings: visResult.issues.filter(i => i.severity === 'warning').length > 0 ? visResult.issues.filter(i => i.severity === 'warning') : undefined
      };
    }

    case 'patchNode': {
      const resolved = batchResolveNodeId(params, ctx.idMap);
      if (resolved.error) {
        return { success: false, error: resolved.error };
      }

      const { props } = params;
      if (!props || Object.keys(props).length === 0) {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'patchNode requires non-empty props.' } };
      }

      if (patchCache && !patchCache.shouldApply(resolved.nodeId!, 'properties', props)) {
        return { success: true, nodeId: resolved.nodeId, message: 'Skipped - redundant update' };
      }

      const node = await figma.getNodeByIdAsync(resolved.nodeId!) as SceneNode;
      if (!node) {
        return { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${resolved.nodeId} not found.` } };
      }

      const currentDSL = NodeSerializer.serialize(node);
      const mergedProps = deepMerge(currentDSL.props || {}, props);

      const result = await handleUnifiedRender({
        ...currentDSL,
        props: mergedProps,
        __modifyMode: 'UPDATE',
        __modifyTargetId: resolved.nodeId,
        designSystemId: toolContext?.designSystemId || 'vanilla',
        streamSessionId: `agent-batch-patch-${Date.now()}`,
        meta: { traceId: 'agent-batch-tool' }
      }, false, node.parent as any);

      if (!result) {
        return { success: false, nodeId: resolved.nodeId, error: { code: 'APPLY_ERROR', message: 'Failed to patch node.' } };
      }

      const visResult = validateVisibility(result);
      if (!visResult.valid) {
        visResult.issues.filter(i => i.severity === 'error').forEach(i => i.autoFix?.());
      }

      return { 
        success: true, 
        nodeId: resolved.nodeId, 
        modified: true,
        propsUpdated: Object.keys(props),
        visibilityWarnings: visResult.issues.filter(i => i.severity === 'warning').length > 0 ? visResult.issues.filter(i => i.severity === 'warning') : undefined
      };
    }

    case 'createIcon': {
      const { iconName, size, color } = params;
      if (!iconName) {
        return { success: false, error: { code: 'INVALID_OPERATION', message: 'createIcon requires iconName.' } };
      }

      const parentResolution = batchResolveParentId(params, ctx.idMap);
      if (parentResolution.error) {
        return { success: false, error: parentResolution.error };
      }

      const explicitParent = await nodeLayoutService.resolveParent(parentResolution.parentId);
      if (!explicitParent && parentResolution.parentId) {
        return {
          success: false,
          error: {
            code: 'PARENT_NOT_FOUND',
            message: `Parent '${parentResolution.parentId}' not found. Aborting createIcon to prevent page-root leakage.`
          }
        };
      }

      const sanitized = sanitizeFlatProps(params.props);
      delete sanitized.width;
      delete sanitized.height;

      const node = await handleUnifiedRender({
        type: 'ICON',
        props: {
          iconName,
          width: size,
          height: size,
          fills: color ? [color] : undefined,
          ...sanitized
        },
        designSystemId: toolContext?.designSystemId || 'vanilla',
        streamSessionId: `agent-batch-${Date.now()}`,
        meta: { traceId: 'agent-batch-tool' }
      }, false, explicitParent);

      if (!node) {
        return { success: false, error: { code: 'APPLY_ERROR', message: 'Failed to create icon.' } };
      }

      ctx.registerCreated(params._opId || '', node.id);

      if (params.layout) await nodeLayoutService.applyLayout(node.id, params.layout);
      if (params.styles) await nodeLayoutService.applyStyles(node.id, params.styles);

      return { success: true, nodeId: node.id, name: node.name || iconName };
    }

    case 'setNodeLayout': {
      const resolved = batchResolveNodeId(params, ctx.idMap);
      if (resolved.error) {
        return { success: false, error: resolved.error };
      }

      const { nodeId: _nodeId, nodeRef: _nodeRef, stepId: _stepId, ...layoutData } = params;

      if (!patchCache.shouldApply(resolved.nodeId!, 'layout', layoutData)) {
        return { success: true, nodeId: resolved.nodeId };
      }

      const layoutResponse = await nodeLayoutService.applyLayout(resolved.nodeId!, layoutData);
      return layoutResponse.success
        ? { success: true, nodeId: resolved.nodeId }
        : { success: false, nodeId: resolved.nodeId, error: layoutResponse.error };
    }

    case 'setNodeStyles': {
      const resolved = batchResolveNodeId(params, ctx.idMap);
      if (resolved.error) {
        return { success: false, error: resolved.error };
      }

      const { fills, strokes, strokeWeight, cornerRadius, opacity } = params;
      const stylesData = { fills, strokes, strokeWeight, cornerRadius, opacity };

      if (!patchCache.shouldApply(resolved.nodeId!, 'styles', stylesData)) {
        return { success: true, nodeId: resolved.nodeId };
      }

      const stylesResponse = await nodeLayoutService.applyStyles(resolved.nodeId!, stylesData);
      return stylesResponse.success
        ? { success: true, nodeId: resolved.nodeId }
        : { success: false, nodeId: resolved.nodeId, error: stylesResponse.error };
    }

    case 'updateNodeProperties': {
      const resolved = batchResolveNodeId(params, ctx.idMap);
      if (resolved.error) {
        return { success: false, error: resolved.error };
      }

      const { properties } = params;
      if (!properties) {
        return { success: false, error: { code: 'INVALID_OPERATION', message: 'updateNodeProperties requires properties.' } };
      }

      if (!patchCache.shouldApply(resolved.nodeId!, 'properties', properties)) {
        return { success: true, nodeId: resolved.nodeId };
      }

      const node = await figma.getNodeByIdAsync(resolved.nodeId!) as SceneNode;
      if (!node) {
        return { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${resolved.nodeId} not found.` } };
      }

      const serialized = NodeSerializer.serialize(node);
      const result = await handleUnifiedRender({
        ...serialized,
        props: { ...(serialized.props || {}), ...properties },
        __modifyMode: 'UPDATE',
        __modifyTargetId: resolved.nodeId,
        designSystemId: toolContext?.designSystemId || 'vanilla',
        streamSessionId: `agent-batch-update-${Date.now()}`,
        meta: { traceId: 'agent-batch-tool' }
      }, false, node.parent as any);

      if (!result) {
        return { success: false, nodeId: resolved.nodeId, error: { code: 'APPLY_ERROR', message: 'Failed to update node properties.' } };
      }
      return { success: true, nodeId: resolved.nodeId };
    }

    case 'deleteNode': {
      const resolved = batchResolveNodeId(params, ctx.idMap);
      if (resolved.error) {
        return { success: false, error: resolved.error };
      }

      const deleteResponse = await nodeLayoutService.deleteNode(resolved.nodeId!);
      return deleteResponse.success
        ? { success: true, nodeId: resolved.nodeId }
        : { success: false, nodeId: resolved.nodeId, error: deleteResponse.error };
    }

    case 'applyDesignPatch': {
      const patches = Array.isArray(params?.patches) ? params.patches : [];
      if (patches.length === 0) {
        return { success: false, error: { code: 'INVALID_OPERATION', message: 'applyDesignPatch requires patches array.' } };
      }

      const resolvedPatches = [];
      let patchError: { code: string; message: string } | null = null;
      let skippedCount = 0;

      for (const patch of patches) {
        const patchNodeId = patch?.nodeId || (patch?.nodeRef ? ctx.idMap[patch.nodeRef] : undefined);
        if (!patchNodeId) {
          patchError = { code: 'MISSING_REF', message: `patch nodeRef '${patch?.nodeRef}' could not be resolved to a nodeId.` };
          break;
        }
        resolvedPatches.push({ ...patch, nodeId: patchNodeId });
      }

      if (patchError) {
        return { success: false, error: patchError };
      }

      for (const patch of resolvedPatches) {
        const { nodeId, layout, styles, properties: legacyProps, props: newProps } = patch;
        const properties = newProps || legacyProps;
        let nodeSkipped = true;

        if (layout) {
          if (patchCache.shouldApply(nodeId, 'layout', layout)) {
            nodeSkipped = false;
            const layoutResult = await nodeLayoutService.applyLayout(nodeId, layout);
            if (!layoutResult.success && !patchError) {
              patchError = layoutResult.error || { code: 'APPLY_ERROR', message: 'Failed to apply layout patch.' };
            }
          }
        }
        if (styles) {
          if (patchCache.shouldApply(nodeId, 'styles', styles)) {
            nodeSkipped = false;
            const stylesResult = await nodeLayoutService.applyStyles(nodeId, styles);
            if (!stylesResult.success && !patchError) {
              patchError = stylesResult.error || { code: 'APPLY_ERROR', message: 'Failed to apply style patch.' };
            }
          }
        }
        if (properties) {
          if (patchCache.shouldApply(nodeId, 'properties', properties)) {
            nodeSkipped = false;
            const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
            if (!node) {
              patchError = { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` };
            } else {
              const serialized = NodeSerializer.serialize(node);
              try {
                await handleUnifiedRender({
                  ...serialized,
                  props: { ...(serialized.props || {}), ...sanitizeFlatProps(properties) },
                  __modifyMode: 'UPDATE',
                  __modifyTargetId: nodeId,
                }, false, node.parent as any);
              } catch (e: any) {
                if (!patchError) {
                  patchError = { code: 'APPLY_ERROR', message: e.message };
                }
              }
            }
          }
        }

        if (nodeSkipped && !patch.layout && !patch.styles && !patch.properties) {
          // Empty or already applied
        } else if (nodeSkipped) {
          skippedCount++;
        }
      }

      if (patchError) {
        return { success: false, error: patchError };
      }
      return {
        success: true,
        patched: resolvedPatches.length,
        skipped: skippedCount > 0 ? true : undefined,
        message: skippedCount > 0 ? `Skipped ${skippedCount} of ${resolvedPatches.length} redundant patches.` : undefined
      };
    }

    default:
      return { success: false, error: { code: 'INVALID_ACTION', message: `Unsupported action '${action}'.` } };
  }
}

/**
 * [INCREMENTAL] Precondition Validation
 *
 * Validates layout constraints before execution to prevent Figma silent corrections.
 * Covers both flat params (setNodeLayout) and patches arrays (applyDesignPatch).
 */
export async function validatePreconditions(action: string, params: any): Promise<{ valid: boolean, error?: string }> {
  // --- applyDesignPatch: validate each patch in the patches array ---
  if (action === 'applyDesignPatch' && Array.isArray(params.patches)) {
    for (const patch of params.patches) {
      const patchNodeId = patch.nodeId;
      if (!patchNodeId) continue;

      const layoutMode = patch.layout?.layoutMode || patch.props?.layoutMode;
      if (layoutMode && layoutMode !== 'NONE') {
        const node = await figma.getNodeByIdAsync(patchNodeId);
        if (node?.type === 'TEXT') {
          return { valid: false, error: `Patch on TEXT node '${patchNodeId}': layoutMode '${layoutMode}' not supported. TEXT nodes only accept layoutMode='NONE'.` };
        }
      }

      const sizing = patch.layout?.sizing || patch.props?.sizing;
      if (sizing && (sizing.horizontal === 'FILL' || sizing.vertical === 'FILL')) {
        const node = await figma.getNodeByIdAsync(patchNodeId) as SceneNode;
        if (node?.parent && !('layoutMode' in node.parent && node.parent.layoutMode !== 'NONE')) {
          return { valid: false, error: `Patch on '${patchNodeId}': FILL sizing requires a parent with Auto Layout.` };
        }
      }
    }
    return { valid: true };
  }

  // --- Flat params (setNodeLayout, updateNodeProperties, etc.) ---
  // 1. Text node layout constraints
  if ((action === 'setNodeLayout' || action === 'applyDesignPatch') && params.layoutMode) {
    const nodeId = params.nodeId;
    if (nodeId) {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (node?.type === 'TEXT' && params.layoutMode !== 'NONE') {
        return { valid: false, error: `TEXT nodes do not support layoutMode '${params.layoutMode}'. Use layoutMode='NONE'.` };
      }
    }
  }

  // 2. FILL sizing constraints
  if ((action === 'setNodeLayout' || action === 'applyDesignPatch') && params.sizing) {
    const isFill = params.sizing.horizontal === 'FILL' || params.sizing.vertical === 'FILL';
    if (isFill) {
      const nodeId = params.nodeId;
      if (nodeId) {
        const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
        if (node?.parent && !('layoutMode' in node.parent && node.parent.layoutMode !== 'NONE')) {
          return { valid: false, error: `'FILL' sizing requires a parent with Auto Layout.` };
        }
      }
    }
  }

  return { valid: true };
}
