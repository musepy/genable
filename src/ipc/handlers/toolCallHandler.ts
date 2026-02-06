/**
 * @file toolCallHandler.ts
 * @description IPC handler for TOOL_CALL events.
 * 
 * [RESPONSIBILITY]: Route tool calls to appropriate services.
 * [PATTERN]: Command Handler - thin layer that delegates to services.
 */

import { ToolResultHandler } from '../../types';
import { nodeLayoutService } from '../../engine/services';
import { ToolResponse, ToolContext } from '../../engine/agent/tools/types';
import { emit } from '@create-figma-plugin/utilities';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { handleUnifiedRender } from '../helpers/renderHelper';
import { planState } from '../../engine/agent/planState';
import { projectUITools } from '../../engine/agent/tools/projectUITools';
import { figmaVariableCache } from '../../engine/figma-adapter/caches/figmaVariableCache';
import { validateVisibility } from '../../engine/validation/visibilityValidator';
import { patchCache } from '../../engine/validation/patchCache';

export interface ToolCallData {
  toolName: string;
  parameters: any;
  context?: ToolContext;
  requestId: string;
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
    console.log(`[Agent] Normalizing tool name: ${toolName} -> ${normalizedName}`);
    toolName = normalizedName;
  }

  console.log(`[Agent] Tool Call: ${toolName}`, { parameters, requestId });

  let response: ToolResponse;

  try {
    switch (toolName) {
      // ==========================================
      // 1. Selection & Query Tools
      // ==========================================
      case 'getSelection': {
        const selection = nodeLayoutService.getSelection();
        response = { success: true, data: selection };
        break;
      }

      case 'getDeepHierarchy': {
        const { nodeId, depthLimit } = parameters;
        const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
        if (!node) {
          response = { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` } };
          break;
        }
        // Use the serializer with specified depth
        const serialized = NodeSerializer.serializeWithCompression(node, { 
          maxDepth: depthLimit || 5,
          pruneDefaults: false 
        });
        response = { success: true, data: serialized };
        break;
      }

      // ==========================================
      // 1.5. Planning Tool (ReAct Pattern - No Side Effects)
      // ==========================================
      case 'planDesign': {
        // planDesign is a pure planning tool - it structures the LLM's thinking
        // but doesn't actually modify Figma. We track it in planState.
        const { analysis, steps, contentPlan, layoutStrategy } = parameters;
        
        // Generate unique step IDs and store in runtime state
        const stepsWithIds = (steps || []).map((step: any, idx: number) => ({
          ...step,
          stepId: `step_${Date.now()}_${idx}`,
          status: 'pending'
        }));

        planState.setCurrentPlan(stepsWithIds);

        console.log('[Agent] planDesign received:', { 
          analysis: analysis?.substring(0, 300) + (analysis?.length > 300 ? '...' : ''), 
          stepsCount: stepsWithIds.length 
        });

        response = { 
          success: true, 
          data: { 
            acknowledged: true, 
            planId: `plan_${Date.now()}`,
            steps: stepsWithIds.map((s: any) => ({ 
              stepId: s.stepId, 
              stepNumber: s.stepNumber,
              action: s.action 
            })),
            message: 'Plan received. Execute steps by referencing stepId.' 
          } 
        };
        break;
      }

      // ==========================================
      // 2. Atomic Creation
      // ==========================================
      case 'createNode': {
        const { type, name, parentId, characters } = parameters;
        const explicitParent = await nodeLayoutService.resolveParent(parentId);
        
        const node = await handleUnifiedRender({
          type,
          props: { 
            name: name || 'unnamed', 
            characters: characters || '' 
          },
          designSystemId: context?.designSystemId || 'vanilla',
          streamSessionId: 'agent-' + Date.now(),
          meta: { traceId: 'agent-atomic-tool' }
        }, false, explicitParent);
        
        let visibilityWarnings: any[] = [];
        let autoFixed: string[] = [];
        
        if (node) {
          // 🟢 P3: Inline Layout/Styles support
          if (parameters.layout) {
            await nodeLayoutService.applyLayout(node.id, parameters.layout);
          }
          if (parameters.styles) {
            await nodeLayoutService.applyStyles(node.id, parameters.styles);
          }
          
          const visResult = validateVisibility(node);
          if (!visResult.valid) {
            // Apply auto-fixes for errors
            visResult.issues.filter(i => i.severity === 'error').forEach(i => i.autoFix?.());
            visibilityWarnings = visResult.issues.filter(i => i.severity === 'warning');
            autoFixed = visResult.autoFixed;
          }
        }
        
        response = { 
          success: !!node, 
          data: { 
            nodeId: node?.id, 
            name: node?.name,
            type: node?.type,
            applied: { name, characters },
            visibilityWarnings: visibilityWarnings.length > 0 ? visibilityWarnings : undefined,
            visibilityAutoFixed: autoFixed.length > 0 ? autoFixed : undefined
          } 
        };
        
        if (node && parameters.stepId) {
          planState.completeTask(parameters.stepId);
        }
        break;
      }

      // ==========================================
      // 3. Atomic Layout
      // ==========================================
      case 'setNodeLayout': {
        const { nodeId, layoutMode, sizing, padding, gap, width, height } = parameters;
        
        const layoutData = { layoutMode, sizing, width, height, gap, padding };
        if (!patchCache.shouldApply(nodeId, 'layout', layoutData)) {
          // Idempotency: Return clean success
          response = { success: true, data: { nodeId } };
          if (parameters.stepId) {
            planState.completeTask(parameters.stepId);
          }
          break;
        }

        response = await nodeLayoutService.applyLayout(nodeId, layoutData);
        if (response.success) {
          response.data = { ...response.data, applied: layoutData };
          if (parameters.stepId) {
            planState.completeTask(parameters.stepId);
          }
        }
        break;
      }

      // ==========================================
      // 4. Atomic Styling
      // ==========================================
      case 'setNodeStyles': {
        const { nodeId, fills, strokes, strokeWeight, cornerRadius, opacity } = parameters;
        
        const stylesData = { fills, strokes, strokeWeight, cornerRadius, opacity };
        if (!patchCache.shouldApply(nodeId, 'styles', stylesData)) {
          // Idempotency: Return clean success
          response = { success: true, data: { nodeId } };
          if (parameters.stepId) {
            planState.completeTask(parameters.stepId);
          }
          break;
        }

        response = await nodeLayoutService.applyStyles(nodeId, stylesData);
        if (response.success) {
          response.data = { ...response.data, applied: stylesData };
          if (parameters.stepId) {
            planState.completeTask(parameters.stepId);
          }
        }
        break;
      }

      // ==========================================
      // 5. Updates & Properties
      // ==========================================
      case 'updateNodeProperties': {
        const { nodeId, properties } = parameters;

        if (!patchCache.shouldApply(nodeId, 'properties', properties)) {
          // Idempotency: Return clean success
          response = { success: true, data: { nodeId } };
          if (parameters.stepId) {
            planState.completeTask(parameters.stepId);
          }
          break;
        }

        const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
        
        if (!node) {
          response = { 
            success: false, 
            error: { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` } 
          };
          break;
        }
        
        const serialized = NodeSerializer.serialize(node);
        const updatedDSL = {
          ...serialized,
          props: { ...(serialized.props || {}), ...properties }
        };
        
        const result = await handleUnifiedRender({
          ...updatedDSL,
          __modifyMode: 'UPDATE',
          __modifyTargetId: nodeId,
          designSystemId: context?.designSystemId || 'vanilla',
          streamSessionId: 'agent-update-' + Date.now(),
          meta: { traceId: 'agent-tool' }
        }, false, node.parent as any);
        
        // FIX: Return original nodeId to prevent LLM confusion about ID changes
        // The internal renderer may create a replacement node, but the LLM should
        // continue referencing the logical node by its original ID
        response = { 
          success: !!result, 
          data: { 
            nodeId: nodeId,  // Use original ID, not result.id
            modified: true,
            note: 'Properties updated successfully. Continue using the same nodeId.' 
          } 
        };

        if (response.success && parameters.stepId) {
          planState.completeTask(parameters.stepId);
        }
        break;
      }

      // ==========================================
      // 6. Special Creation Tools
      // ==========================================
      case 'createIcon': {
        const { iconName, size, color, parentId } = parameters;
        const explicitParent = await nodeLayoutService.resolveParent(parentId);
        
        const node = await handleUnifiedRender({
          type: 'ICON',
          props: { 
            iconName, 
            width: size, 
            height: size, 
            fills: color ? [color] : undefined 
          },
          designSystemId: context?.designSystemId || 'vanilla',
          streamSessionId: 'agent-' + Date.now(),
          meta: { traceId: 'agent-tool' }
        }, false, explicitParent);
        
        if (node) {
          // 🟢 P3: Inline Layout/Styles support
          if (parameters.layout) {
            await nodeLayoutService.applyLayout(node.id, parameters.layout);
          }
          if (parameters.styles) {
            await nodeLayoutService.applyStyles(node.id, parameters.styles);
          }
        }
        
        response = { success: !!node, data: { nodeId: node?.id } };

        if (node && parameters.stepId) {
          planState.completeTask(parameters.stepId);
        }
        break;
      }

      // ==========================================
      // 7. Deletion
      // ==========================================
      case 'deleteNode': {
        response = await nodeLayoutService.deleteNode(parameters.nodeId);
        break;
      }

      // ==========================================
      // 8. Read & Inspection Tools
      // ==========================================
      case 'getVariables': {
        try {
          await figmaVariableCache.warmup();
          const names = Array.from((figmaVariableCache as any).variableMap.keys());
          response = { success: true, data: { variables: names } };
        } catch (e: any) {
          response = { success: false, error: { code: 'SYNC_ERROR', message: e.message } };
        }
        break;
      }

      case 'getStyles': {
        try {
          await figmaVariableCache.warmup();
          const names = Array.from((figmaVariableCache as any).styleMap.keys());
          response = { success: true, data: { styles: names } };
        } catch (e: any) {
          response = { success: false, error: { code: 'SYNC_ERROR', message: e.message } };
        }
        break;
      }

      case 'getNodeDSL': {
        try {
          const node = await figma.getNodeByIdAsync(parameters.nodeId) as SceneNode;
          if (!node) {
            response = { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${parameters.nodeId} not found.` } };
            break;
          }
          const serialized = NodeSerializer.serialize(node);
          response = { success: true, data: serialized };
        } catch (e: any) {
          response = { success: false, error: { code: 'SERIALIZATION_ERROR', message: e.message } };
        }
        break;
      }

      // ==========================================
      // 8.5. Unified Inspection (replaces getSelection/getDeepHierarchy/getNodeDSL)
      // ==========================================
      case 'inspectDesign': {
        const { mode: inspectMode, nodeId: inspectNodeId, depth: inspectDepth } = parameters;

        switch (inspectMode) {
          case 'selection': {
            const selection = nodeLayoutService.getSelection();
            response = { success: true, data: selection };
            break;
          }
          case 'hierarchy': {
            if (!inspectNodeId) {
              response = { success: false, error: { code: 'MISSING_PARAM', message: 'nodeId is required for hierarchy mode.' } };
              break;
            }
            const hNode = await figma.getNodeByIdAsync(inspectNodeId) as SceneNode;
            if (!hNode) {
              response = { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${inspectNodeId} not found.` } };
              break;
            }
            const hSerialized = NodeSerializer.serializeWithCompression(hNode, {
              maxDepth: Math.min(inspectDepth || 5, 10),
              pruneDefaults: false
            });
            response = { success: true, data: hSerialized };
            break;
          }
          case 'node': {
            if (!inspectNodeId) {
              response = { success: false, error: { code: 'MISSING_PARAM', message: 'nodeId is required for node mode.' } };
              break;
            }
            const nNode = await figma.getNodeByIdAsync(inspectNodeId) as SceneNode;
            if (!nNode) {
              response = { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${inspectNodeId} not found.` } };
              break;
            }
            const nSerialized = NodeSerializer.serialize(nNode);
            response = { success: true, data: nSerialized };
            break;
          }
          default:
            response = { success: false, error: { code: 'INVALID_MODE', message: `inspectDesign mode '${inspectMode}' is not valid. Use 'selection', 'hierarchy', or 'node'.` } };
        }
        break;
      }

      // ==========================================
      // 8.6. Design Super Tools
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

        const allowedActions = new Set([
          'createNode',
          'setNodeLayout',
          'setNodeStyles',
          'updateNodeProperties',
          'createIcon',
          'deleteNode',
          'applyDesignPatch'
        ]);

        const results: any[] = [];
        const idMap: Record<string, string> = {};
        const opStatus = new Map<string, { success: boolean; error?: { code: string; message: string } }>();
        const seenOpIds = new Set<string>();

        const recordResult = (opId: string | undefined, result: any) => {
          results.push(result);
          if (opId) {
            opStatus.set(opId, { success: result.success, error: result.error });
          }
        };

        const dependencyError = (depId: string, status?: { success: boolean; error?: { code: string; message: string } }) => {
          const detail = status?.error?.message ? ` ${status.error.message}` : '';
          const message = status
            ? `Dependency '${depId}' failed.${detail}`
            : `Dependency '${depId}' was not executed before this operation.`;
          const code = onError === 'skip-dependents' ? 'DEPENDENCY_SKIP' : 'MISSING_REF';
          return { code, message };
        };

        const shouldSkipForDependencies = (deps: Set<string>) => {
          for (const depId of deps) {
            const status = opStatus.get(depId);
            if (!status) return dependencyError(depId);
            if (!status.success) return dependencyError(depId, status);
          }
          return null;
        };

        const addRefDependency = (deps: Set<string>, ref: any) => {
          if (typeof ref === 'string' && ref !== 'root') {
            deps.add(ref);
          }
        };

        const resolveNodeId = (params: any): { nodeId?: string; error?: { code: string; message: string } } => {
          if (params?.nodeId) return { nodeId: params.nodeId };
          if (params?.nodeRef) {
            const nodeId = idMap[params.nodeRef];
            if (!nodeId) {
              return { error: { code: 'MISSING_REF', message: `nodeRef '${params.nodeRef}' could not be resolved to a nodeId.` } };
            }
            return { nodeId };
          }
          return { error: { code: 'MISSING_REF', message: 'nodeId or nodeRef is required.' } };
        };

        const resolveParentId = (params: any): { parentId?: string; error?: { code: string; message: string } } => {
          if (params?.parentId) return { parentId: params.parentId };
          if (!params?.parentRef || params.parentRef === 'root') return { parentId: undefined };
          const parentId = idMap[params.parentRef];
          if (!parentId) {
            return { error: { code: 'MISSING_REF', message: `parentRef '${params.parentRef}' could not be resolved to a nodeId.` } };
          }
          return { parentId };
        };

          const executeSingleOperation = async (operation: any): Promise<any> => {
            const opId = operation?.opId;
            const action = operation?.action;
            const params = operation?.params || {};

            if (!opId || typeof opId !== 'string') {
                return {
                    opId,
                    action,
                    success: false,
                    error: { code: 'INVALID_OPERATION', message: 'opId is required for each operation.' }
                };
            }

            if (seenOpIds.has(opId)) {
                return {
                    opId,
                    action,
                    success: false,
                    error: { code: 'INVALID_OPERATION', message: `Duplicate opId '${opId}' in batch.` }
                };
            }
            seenOpIds.add(opId);

            if (!action || typeof action !== 'string' || !allowedActions.has(action)) {
                return {
                    opId,
                    action,
                    success: false,
                    error: { code: 'INVALID_ACTION', message: `Unsupported action '${action}'.` }
                };
            }

            const deps = new Set<string>();
            if (Array.isArray(operation?.dependsOn)) {
                for (const dep of operation.dependsOn) {
                    if (typeof dep === 'string') deps.add(dep);
                }
            }

            if (action === 'createNode' || action === 'createIcon') {
                addRefDependency(deps, params?.parentRef);
            } else if (action === 'applyDesignPatch') {
                const patches = Array.isArray(params?.patches) ? params.patches : [];
                for (const patch of patches) {
                    addRefDependency(deps, patch?.nodeRef);
                }
            } else {
                addRefDependency(deps, params?.nodeRef);
            }

            const dependencyIssue = shouldSkipForDependencies(deps);
            if (dependencyIssue) {
                return {
                    opId,
                    action,
                    success: false,
                    skipped: onError === 'skip-dependents',
                    error: dependencyIssue
                };
            }

            let opResult: any = { opId, action, success: false };

            try {
                switch (action) {
                    case 'createNode': {
                        const { type, name, characters, children } = params;
                        if (!type) {
                            opResult = {
                                opId,
                                action,
                                success: false,
                                error: { code: 'INVALID_OPERATION', message: 'createNode requires type.' }
                            };
                            break;
                        }

                        const parentResolution = resolveParentId(params);
                        if (parentResolution.error) {
                            opResult = { opId, action, success: false, error: parentResolution.error };
                            break;
                        }

                        const explicitParent = await nodeLayoutService.resolveParent(parentResolution.parentId);
                        // Detect silent parent resolution failures that cause node leaking to page root
                        if (!explicitParent && parentResolution.parentId) {
                            console.warn(`[batchOps] ⚠️ Parent '${parentResolution.parentId}' not found for op '${opId}' - node will leak to page root`);
                        } else if (!explicitParent && !params.parentRef && !params.parentId) {
                            console.warn(`[batchOps] ⚠️ No parent specified for op '${opId}' (${name || type}) - node placed at page root`);
                        }
                        const node = await handleUnifiedRender({
                            type,
                            props: {
                                name: name || 'unnamed',
                                characters: characters || ''
                            },
                            designSystemId: context?.designSystemId || 'vanilla',
                            streamSessionId: `agent-batch-${Date.now()}-${opId}`,
                            meta: { traceId: 'agent-batch-tool' }
                        }, false, explicitParent);

                        if (!node) {
                            opResult = {
                                opId,
                                action,
                                success: false,
                                error: { code: 'APPLY_ERROR', message: 'Failed to create node.' }
                            };
                            break;
                        }

                        // Register ID for virtual mapping
                        idMap[opId] = node.id;
                        opStatus.set(opId, { success: true });

                        // 🟢 P3: Inline Layout/Styles support in batch
                        if (params.layout) {
                          await nodeLayoutService.applyLayout(node.id, params.layout);
                        }
                        if (params.styles) {
                          await nodeLayoutService.applyStyles(node.id, params.styles);
                        }

                        const visResult = validateVisibility(node);
                        if (!visResult.valid) {
                            visResult.issues.filter(i => i.severity === 'error').forEach(i => i.autoFix?.());
                        }

                        const childResults: any[] = [];
                        if (Array.isArray(children)) {
                            for (const childOp of children) {
                                // Inject parentRef only if not already specified
                                const childParams = childOp.params || {};
                                const hasExplicitParent = childParams.parentRef || childParams.parentId;
                                const childResult = await executeSingleOperation({
                                    ...childOp,
                                    params: {
                                      ...childParams,
                                      ...(!hasExplicitParent && { parentRef: opId })
                                    }
                                });
                                childResults.push(childResult);
                            }
                        }

                        opResult = {
                            opId,
                            action,
                            success: true,
                            nodeId: node.id,
                            name: node.name,
                            children: childResults.length > 0 ? childResults : undefined,
                            visibilityWarnings: visResult.issues.filter(i => i.severity === 'warning').length > 0 ? visResult.issues.filter(i => i.severity === 'warning') : undefined,
                            visibilityAutoFixed: visResult.autoFixed.length > 0 ? visResult.autoFixed : undefined
                        };
                        break;
                    }

                    case 'createIcon': {
                        const { iconName, size, color } = params;
                        if (!iconName) {
                            opResult = {
                                opId,
                                action,
                                success: false,
                                error: { code: 'INVALID_OPERATION', message: 'createIcon requires iconName.' }
                            };
                            break;
                        }

                        const parentResolution = resolveParentId(params);
                        if (parentResolution.error) {
                            opResult = { opId, action, success: false, error: parentResolution.error };
                            break;
                        }

                        const explicitParent = await nodeLayoutService.resolveParent(parentResolution.parentId);
                        if (!explicitParent && parentResolution.parentId) {
                            console.warn(`[batchOps] ⚠️ Parent '${parentResolution.parentId}' not found for icon op '${opId}' - node will leak to page root`);
                        }
                        const node = await handleUnifiedRender({
                            type: 'ICON',
                            props: {
                                iconName,
                                width: size,
                                height: size,
                                fills: color ? [color] : undefined
                            },
                            designSystemId: context?.designSystemId || 'vanilla',
                            streamSessionId: `agent-batch-${Date.now()}-${opId}`,
                            meta: { traceId: 'agent-batch-tool' }
                        }, false, explicitParent);

                        if (!node) {
                            opResult = {
                                opId,
                                action,
                                success: false,
                                error: { code: 'APPLY_ERROR', message: 'Failed to create icon.' }
                            };
                            break;
                        }

                        idMap[opId] = node.id;
                        opStatus.set(opId, { success: true });

                        // 🟢 P3: Inline Layout/Styles support for Icon in batch
                        if (params.layout) {
                          await nodeLayoutService.applyLayout(node.id, params.layout);
                        }
                        if (params.styles) {
                          await nodeLayoutService.applyStyles(node.id, params.styles);
                        }

                        opResult = { opId, action, success: true, nodeId: node.id, name: node.name || iconName };
                        break;
                    }

                     case 'setNodeLayout': {
                        const resolved = resolveNodeId(params);
                        if (resolved.error) {
                            opResult = { opId, action, success: false, error: resolved.error };
                            break;
                        }

                        const { layoutMode, sizing, padding, gap, width, height } = params;
                        const layoutData = { layoutMode, sizing, width, height, gap, padding };
                        
                        if (!patchCache.shouldApply(resolved.nodeId!, 'layout', layoutData)) {
                            // Idempotency: Return clean success to the agent
                            opResult = { opId, action, success: true, nodeId: resolved.nodeId };
                            if (params?.stepId) {
                                planState.completeTask(params.stepId);
                            }
                            break;
                        }

                        const layoutResponse = await nodeLayoutService.applyLayout(resolved.nodeId!, layoutData);

                        if (!layoutResponse.success) {
                            opResult = { opId, action, success: false, nodeId: resolved.nodeId, error: layoutResponse.error };
                        } else {
                            opResult = { opId, action, success: true, nodeId: resolved.nodeId };
                        }
                        break;
                    }

                    case 'setNodeStyles': {
                        const resolved = resolveNodeId(params);
                        if (resolved.error) {
                            opResult = { opId, action, success: false, error: resolved.error };
                            break;
                        }

                        const { fills, strokes, strokeWeight, cornerRadius, opacity } = params;
                        const stylesData = { fills, strokes, strokeWeight, cornerRadius, opacity };

                        if (!patchCache.shouldApply(resolved.nodeId!, 'styles', stylesData)) {
                            // Idempotency: Return clean success to the agent
                            opResult = { opId, action, success: true, nodeId: resolved.nodeId };
                            if (params?.stepId) {
                                planState.completeTask(params.stepId);
                            }
                            break;
                        }

                        const stylesResponse = await nodeLayoutService.applyStyles(resolved.nodeId!, stylesData);

                        if (!stylesResponse.success) {
                            opResult = { opId, action, success: false, nodeId: resolved.nodeId, error: stylesResponse.error };
                        } else {
                            opResult = { opId, action, success: true, nodeId: resolved.nodeId };
                        }
                        break;
                    }

                     case 'updateNodeProperties': {
                        const resolved = resolveNodeId(params);
                        if (resolved.error) {
                            opResult = { opId, action, success: false, error: resolved.error };
                            break;
                        }

                        const { properties } = params;
                        if (!properties) {
                            opResult = {
                                opId,
                                action,
                                success: false,
                                error: { code: 'INVALID_OPERATION', message: 'updateNodeProperties requires properties.' }
                            };
                            break;
                        }

                        if (!patchCache.shouldApply(resolved.nodeId!, 'properties', properties)) {
                            // Idempotency: Return clean success to the agent
                            opResult = { opId, action, success: true, nodeId: resolved.nodeId };
                            if (params?.stepId) {
                                planState.completeTask(params.stepId);
                            }
                            break;
                        }

                        const node = await figma.getNodeByIdAsync(resolved.nodeId!) as SceneNode;
                        if (!node) {
                            opResult = {
                                opId,
                                action,
                                success: false,
                                error: { code: 'NODE_NOT_FOUND', message: `Node ${resolved.nodeId} not found.` }
                            };
                            break;
                        }

                        const serialized = NodeSerializer.serialize(node);
                        const updatedDSL = {
                            ...serialized,
                            props: { ...(serialized.props || {}), ...properties }
                        };

                        const result = await handleUnifiedRender({
                            ...updatedDSL,
                            __modifyMode: 'UPDATE',
                            __modifyTargetId: resolved.nodeId,
                            designSystemId: context?.designSystemId || 'vanilla',
                            streamSessionId: `agent-batch-update-${Date.now()}-${opId}`,
                            meta: { traceId: 'agent-batch-tool' }
                        }, false, node.parent as any);

                        if (!result) {
                            opResult = {
                                opId,
                                action,
                                success: false,
                                nodeId: resolved.nodeId,
                                error: { code: 'APPLY_ERROR', message: 'Failed to update node properties.' }
                            };
                            break;
                        }

                        opResult = { opId, action, success: true, nodeId: resolved.nodeId };
                        break;
                    }

                    case 'deleteNode': {
                        const resolved = resolveNodeId(params);
                        if (resolved.error) {
                            opResult = { opId, action, success: false, error: resolved.error };
                            break;
                        }

                        const deleteResponse = await nodeLayoutService.deleteNode(resolved.nodeId!);
                        if (!deleteResponse.success) {
                            opResult = { opId, action, success: false, nodeId: resolved.nodeId, error: deleteResponse.error };
                        } else {
                            opResult = { opId, action, success: true, nodeId: resolved.nodeId };
                        }
                        break;
                    }

                    case 'applyDesignPatch': {
                        const patches = Array.isArray(params?.patches) ? params.patches : [];
                        if (patches.length === 0) {
                            opResult = {
                                opId,
                                action,
                                success: false,
                                error: { code: 'INVALID_OPERATION', message: 'applyDesignPatch requires patches array.' }
                            };
                            break;
                        }

                        const resolvedPatches = [];
                        let patchError: { code: string; message: string } | null = null;
                        let skippedCount = 0;

                        for (const patch of patches) {
                            const patchNodeId = patch?.nodeId || (patch?.nodeRef ? idMap[patch.nodeRef] : undefined);
                            if (!patchNodeId) {
                                patchError = {
                                    code: 'MISSING_REF',
                                    message: `patch nodeRef '${patch?.nodeRef}' could not be resolved to a nodeId.`
                                };
                                break;
                            }
                            resolvedPatches.push({ ...patch, nodeId: patchNodeId });
                        }

                        if (patchError) {
                            opResult = { opId, action, success: false, error: patchError };
                            break;
                        }

                        for (const patch of resolvedPatches) {
                            const { nodeId, layout, styles, properties } = patch;
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
                                                props: { ...(serialized.props || {}), ...properties },
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
                            opResult = { opId, action, success: false, error: patchError };
                        } else {
                            opResult = {
                                opId,
                                action,
                                success: true,
                                patched: resolvedPatches.length,
                                skipped: skippedCount > 0 ? skippedCount : undefined,
                                message: skippedCount > 0 ? `Skipped ${skippedCount} redundant patches.` : undefined
                            };
                        }
                        break;
                    }
                }
            } catch (e: any) {
                opResult = {
                    opId,
                    action,
                    success: false,
                    error: { code: 'APPLY_ERROR', message: e.message }
                };
            }

            if (opResult?.success && opResult?.nodeId && action !== 'deleteNode') {
                if (!idMap[opId]) idMap[opId] = opResult.nodeId;
            }

            if (opResult?.success && params?.stepId) {
                planState.completeTask(params.stepId);
            }

            recordResult(opId, opResult);
            return opResult;
        };

        for (const operation of operations) {
            await executeSingleOperation(operation);
        }

        const layoutSnapshots: Record<string, any> = {};
        for (const [opId, nodeId] of Object.entries(idMap)) {
            try {
                const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
                if (node) {
                    layoutSnapshots[opId] = NodeSerializer.serialize(node);
                }
            } catch (e) {
                console.warn(`[Agent] Failed to capture snapshot for ${opId} (${nodeId})`, e);
            }
        }

        const hasFailures = results.some(r => !r.success);
        response = hasFailures
            ? {
                success: false,
                data: { results, idMap, layoutSnapshots },
                error: { code: 'PARTIAL_FAILURE', message: 'One or more operations failed.' }
            }
            : { success: true, data: { results, idMap, layoutSnapshots } };
        break;
      }

      case 'applyDesignPatch': {
        const { patches } = parameters;
        const results = [];
        let totalSkipped = 0;

        for (const patch of patches) {
          const { nodeId, layout, styles, properties } = patch;
          const patchSummary: any = { nodeId, applied: {} };
          let nodeSkipped = true;
          
          if (layout) {
             if (patchCache.shouldApply(nodeId, 'layout', layout)) {
               nodeSkipped = false;
               await nodeLayoutService.applyLayout(nodeId, layout);
               patchSummary.applied.layout = layout;
             }
          }
          if (styles) {
             if (patchCache.shouldApply(nodeId, 'styles', styles)) {
               nodeSkipped = false;
               await nodeLayoutService.applyStyles(nodeId, styles);
               patchSummary.applied.styles = styles;
             }
          }
          if (properties) {
            if (patchCache.shouldApply(nodeId, 'properties', properties)) {
              nodeSkipped = false;
              const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
              if (node) {
                const serialized = NodeSerializer.serialize(node);
                await handleUnifiedRender({
                  ...serialized,
                  props: { ...(serialized.props || {}), ...properties },
                  __modifyMode: 'UPDATE',
                  __modifyTargetId: nodeId,
                }, false, node.parent as any);
                patchSummary.applied.properties = properties;
              }
            }
          }
          
          if (nodeSkipped && (layout || styles || properties)) {
            totalSkipped++;
            patchSummary.success = true;
            // Removed patchSummary.skipped = true to avoid Agent confusion
          } else {
            patchSummary.success = true;
          }
          results.push(patchSummary);
        }

        response = { 
          success: true, 
          data: { 
            results,
            summary: {
              total: results.length,
              applied: results.length - totalSkipped,
              skipped: totalSkipped
            }
          } 
        };

        if (response.success && parameters.stepId) {
          planState.completeTask(parameters.stepId);
        }
        break;
      }

      // ==========================================
      // 9. Project UI Context Tools (Pure JS - No Figma API)
      // ==========================================
      case 'getProjectUIContext': {
        response = await projectUITools.executors.getProjectUIContext(parameters);
        break;
      }

      case 'getDesignSystemTokens': {
        response = await projectUITools.executors.getDesignSystemTokens(parameters);
        break;
      }

      case 'listProjectComponents': {
        response = await projectUITools.executors.listProjectComponents(parameters);
        break;
      }

      // ==========================================
      // 10. Unknown Tool
      // ==========================================
      default:
        response = {
          success: false,
          error: { code: 'UNKNOWN_TOOL', message: `Tool '${toolName}' not found in main registry.` }
        };
    }
  } catch (e: any) {
    console.error(`[Agent] Tool Execution Error (${toolName}):`, e);
    response = {
      success: false,
      error: { code: 'EXECUTION_ERROR', message: e.message }
    };
  }

  emit<ToolResultHandler>('TOOL_RESULT', { requestId, response });
}
