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
        
        response = { 
          success: !!node, 
          data: { 
            nodeId: node?.id, 
            name: node?.name,
            type: node?.type,
            applied: { name, characters }
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
        
        response = await nodeLayoutService.applyLayout(nodeId, {
          layoutMode,
          sizing,
          width,
          height,
          gap,
          padding
        });

        if (response.success) {
          response.data = { ...response.data, applied: { layoutMode, sizing, width, height, gap, padding } };
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
        
        response = await nodeLayoutService.applyStyles(nodeId, {
          fills,
          strokes,
          strokeWeight,
          cornerRadius,
          opacity
        });

        if (response.success) {
          response.data = { ...response.data, applied: { fills, strokes, strokeWeight, cornerRadius, opacity } };
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
      case 'applyDesignPatch': {
        const { patches } = parameters;
        const results = [];

        for (const patch of patches) {
          const { nodeId, layout, styles, properties } = patch;
          const patchSummary: any = { nodeId, applied: {} };
          
          if (layout) {
             await nodeLayoutService.applyLayout(nodeId, layout);
             patchSummary.applied.layout = layout;
          }
          if (styles) {
             await nodeLayoutService.applyStyles(nodeId, styles);
             patchSummary.applied.styles = styles;
          }
          if (properties) {
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
          patchSummary.success = true;
          results.push(patchSummary);
        }

        console.log(`[Agent] applyDesignPatch completed for ${results.length} nodes`);
        response = { success: true, data: { results } };
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
