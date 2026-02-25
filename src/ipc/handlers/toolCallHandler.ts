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
import { TreeReconstructor } from '../../engine/figma-adapter/treeReconstructor';
import { diffIntendedVsActual } from '../../engine/validation/mutationDiff';
import { shouldSkipIdempotent, completeStep } from '../helpers/idempotentApply';
import {
  BatchExecutor,
  BatchOpResult,
  ActionContext,
  resolveNodeId as batchResolveNodeId,
  resolveParentId as batchResolveParentId
} from './batchExecutor';
import { deepMerge } from '../../utils/objectUtils';
import { validatePostOp, collectTreeAnomalies } from '../../engine/validation/postOpValidator';

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
        const { type, name, parentId, characters, props: flatProps } = parameters;
        const explicitParent = await nodeLayoutService.resolveParent(parentId);
        
        const node = await handleUnifiedRender({
          type,
          props: { 
            name: name || 'unnamed', 
            characters: characters || '',
            ...sanitizeFlatProps(flatProps)
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
        
        // Post-op anomaly detection (zero-cost when clean)
        const anomalies = node ? validatePostOp(node, sanitizeFlatProps(flatProps)) : [];

        response = {
          success: !!node,
          data: {
            nodeId: node?.id,
            name: node?.name,
            type: node?.type,
            applied: { name, characters },
            visibilityWarnings: visibilityWarnings.length > 0 ? visibilityWarnings : undefined,
            visibilityAutoFixed: autoFixed.length > 0 ? autoFixed : undefined,
            anomalies: anomalies.length > 0 ? anomalies : undefined
          }
        };
        
        if (node) completeStep(parameters.stepId);
        break;
      }

      // ==========================================
      // 3. Atomic Layout
      // ==========================================
      case 'setNodeLayout': {
        const { nodeId, stepId: _stepId, ...layoutData } = parameters;
        const layoutSkip = shouldSkipIdempotent(nodeId, 'layout', layoutData, parameters.stepId);
        if (layoutSkip.skip) { response = layoutSkip.response; break; }

        response = await nodeLayoutService.applyLayout(nodeId, layoutData);
        if (response.success) {
          response.data = { ...response.data, applied: layoutData };
          completeStep(parameters.stepId);
        }
        break;
      }

      // ==========================================
      // 4. Atomic Styling
      // ==========================================
      case 'setNodeStyles': {
        const { nodeId, fills, strokes, strokeWeight, cornerRadius, opacity } = parameters;

        const stylesData = { fills, strokes, strokeWeight, cornerRadius, opacity };
        const stylesSkip = shouldSkipIdempotent(nodeId, 'styles', stylesData, parameters.stepId);
        if (stylesSkip.skip) { response = stylesSkip.response; break; }

        response = await nodeLayoutService.applyStyles(nodeId, stylesData);
        if (response.success) {
          response.data = { ...response.data, applied: stylesData };
          completeStep(parameters.stepId);
        }
        break;
      }

      // ==========================================
      // 5. Updates & Properties
      // ==========================================
      case 'updateNodeProperties': {
        const { nodeId, properties } = parameters;

        const propsSkip = shouldSkipIdempotent(nodeId, 'properties', properties, parameters.stepId);
        if (propsSkip.skip) { response = propsSkip.response; break; }

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

        if (response.success) completeStep(parameters.stepId);
        break;
      }

      // ==========================================
      // 5.5. State-Driven / High-Level Tools
      // ==========================================
      case 'renderSubtree': {
        const { nodes, parentId, stepId } = parameters;

        if (!Array.isArray(nodes) || nodes.length === 0) {
          response = {
            success: false,
            error: { code: 'INVALID_INPUT', message: 'renderSubtree requires a non-empty nodes array' }
          };
          break;
        }

        // Reconstruct flat list -> tree
        const reconstructor = new TreeReconstructor();
        const { root, errors, warnings } = reconstructor.reconstruct(nodes);

        if (!root) {
          response = {
            success: false,
            error: { code: 'RECONSTRUCTION_FAILED', message: errors.join('; ') || 'Failed to reconstruct subtree' }
          };
          break;
        }

        const explicitParent = await nodeLayoutService.resolveParent(parentId);

        const node = await handleUnifiedRender({
          ...root,
          designSystemId: context?.designSystemId || 'vanilla',
          streamSessionId: 'agent-subtree-' + Date.now(),
          meta: { traceId: 'agent-tool' }
        }, false, explicitParent);

        let visibilityWarnings: any[] = [];
        let autoFixed: string[] = [];

        if (node) {
          // Validate strict visibility
          const visResult = validateVisibility(node);
          if (!visResult.valid) {
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
            reconstructionWarnings: warnings.length > 0 ? warnings : undefined,
            visibilityWarnings: visibilityWarnings.length > 0 ? visibilityWarnings : undefined,
            visibilityAutoFixed: autoFixed.length > 0 ? autoFixed : undefined
          }
        };

        if (node) completeStep(stepId);
        break;
      }

      case 'patchNode': {
        const { nodeId, props, stepId } = parameters;

        if (!nodeId || !props || Object.keys(props).length === 0) {
          response = {
            success: false,
            error: { code: 'INVALID_INPUT', message: 'patchNode requires nodeId and non-empty props.' }
          };
          break;
        }

        const skipCheck = shouldSkipIdempotent(nodeId, 'properties', props, stepId);
        if (skipCheck.skip) {
          response = skipCheck.response;
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

        const currentDSL = NodeSerializer.serialize(node);
        const mergedProps = deepMerge(currentDSL.props || {}, props);

        const result = await handleUnifiedRender({
          ...currentDSL,
          props: mergedProps,
          __modifyMode: 'UPDATE',
          __modifyTargetId: nodeId,
          designSystemId: context?.designSystemId || 'vanilla',
          streamSessionId: 'agent-patch-node-' + Date.now(),
          meta: { traceId: 'agent-tool' }
        }, false, node.parent as any);

        let visibilityWarnings: any[] = [];
        let autoFixed: string[] = [];

        if (result) {
          const visResult = validateVisibility(result);
          if (!visResult.valid) {
            visResult.issues.filter(i => i.severity === 'error').forEach(i => i.autoFix?.());
            visibilityWarnings = visResult.issues.filter(i => i.severity === 'warning');
            autoFixed = visResult.autoFixed;
          }
        }

        response = {
          success: !!result,
          data: {
            nodeId: nodeId,
            modified: true,
            propsUpdated: Object.keys(props),
            visibilityWarnings: visibilityWarnings.length > 0 ? visibilityWarnings : undefined,
            visibilityAutoFixed: autoFixed.length > 0 ? autoFixed : undefined
          }
        };

        if (response.success) completeStep(stepId);
        break;
      }

      // ==========================================
      // 6. Special Creation Tools
      // ==========================================
      case 'createIcon': {
        const { iconName, size, color, parentId, props: flatProps } = parameters;
        const explicitParent = await nodeLayoutService.resolveParent(parentId);
        
        const sanitized = sanitizeFlatProps(flatProps);
        // Icon size is controlled by 'size' parameter, don't let flatProps override width/height
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
        if (node) completeStep(parameters.stepId);
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
            // Run anomaly detection on the actual Figma tree (catches issues invisible in DSL)
            const anomalies = collectTreeAnomalies(hNode, Math.min(inspectDepth || 5, 10));
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

      case 'applyDesignPatch': {
        // Validate preconditions for all patches before executing any
        const patchValidation = await validatePreconditions('applyDesignPatch', parameters);
        if (!patchValidation.valid) {
          response = { success: false, error: { code: 'PRECONDITION_FAILED', message: patchValidation.error || 'Precondition check failed.' } };
          break;
        }

        const { patches } = parameters;
        const results = [];
        let totalSkipped = 0;

        for (const patch of patches) {
          const { nodeId, layout, styles, properties: legacyProperties, textAndFont } = patch;
          const properties = textAndFont || legacyProperties;
          
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
                  props: deepMerge(serialized.props || {}, sanitizeFlatProps(properties)),
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
      // 10. One-Shot Design Generation
      // ==========================================
      case 'generateDesign': {
        const { nodes } = parameters;

        if (!Array.isArray(nodes) || nodes.length === 0) {
          response = {
            success: false,
            error: { code: 'INVALID_INPUT', message: 'generateDesign requires a non-empty nodes array.' }
          };
          break;
        }

        // Known style/layout properties that belong inside props.
        // Used as a safety net to catch LLM outputs that place these on the node object directly.
        const KNOWN_STYLE_KEYS = [
          'layoutMode', 'gap', 'padding', 'fills', 'strokes',
          'cornerRadius', 'width', 'height', 'fontSize', 'fontWeight',
          'characters', 'layoutSizingHorizontal', 'layoutSizingVertical',
          'primaryAxisAlignItems', 'counterAxisAlignItems',
          'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
          'opacity', 'visible', 'rotation', 'strokeWeight', 'effects',
          'cornerSmoothing', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
          'layoutGrow', 'layoutAlign', 'layoutPositioning', 'constraints', 'x', 'y', 'itemSpacing',
          'iconName'
        ];

        // Pre-process: Lift nested layout/styles into props for consistency
        // LLM may output either flat props or nested layout/styles objects at top level
        for (const node of nodes) {
          if (!node.props) node.props = {};

          // [DIAGNOSTIC] Log raw node structure before any lifting
          const rawNodeKeys = Object.keys(node).filter(k => k !== 'id' && k !== 'parent' && k !== 'type' && k !== 'props');
          const rawPropsKeys = Object.keys(node.props);
          if (rawNodeKeys.length > 0 || rawPropsKeys.length <= 1) {
            console.log(`[generateDesign] 🔍 Node "${node.id}" BEFORE lifting — top-level keys: [${rawNodeKeys.join(', ')}], props keys: [${rawPropsKeys.join(', ')}]`);
          }

          // 1. Lift from props.layout/props.styles (Existing)
          if (node.props.layout && typeof node.props.layout === 'object') {
            Object.assign(node.props, node.props.layout);
            delete node.props.layout;
          }
          if (node.props.styles && typeof node.props.styles === 'object') {
            Object.assign(node.props, node.props.styles);
            delete node.props.styles;
          }

          // 2. Lift from top-level node.layout/node.styles/node.style
          // catches LLM structure mismatch where it puts these keys alongside 'props'
          const topLevelLayout = (node as any).layout;
          const topLevelStyles = (node as any).styles || (node as any).style;
          
          if (topLevelLayout && typeof topLevelLayout === 'object') {
            console.log(`[generateDesign] Lifting top-level layout for node: ${node.id}`);
            Object.assign(node.props, topLevelLayout);
            delete (node as any).layout;
          }
          if (topLevelStyles && typeof topLevelStyles === 'object') {
            console.log(`[generateDesign] Lifting top-level styles for node: ${node.id}`);
            Object.assign(node.props, topLevelStyles);
            delete (node as any).styles;
            delete (node as any).style;
          }

          // 3. Safety Net: Lift any known style properties found on the node top-level into props
          // This catches cases where LLM places e.g. layoutMode, fills, gap directly on the node
          // instead of inside the props object.
          for (const key of KNOWN_STYLE_KEYS) {
            if ((node as any)[key] !== undefined && node.props[key] === undefined) {
              console.log(`[generateDesign] ⚠️ Safety net: lifting "${key}" from node top-level to props for "${node.id}"`);
              node.props[key] = (node as any)[key];
              delete (node as any)[key];
            }
          }

          // Ensure name fallback to id
          if (!node.props.name && node.id) {
            node.props.name = node.id;
          }

          // [DIAGNOSTIC] Log final props after all lifting
          const finalPropsKeys = Object.keys(node.props);
          const hasStyling = finalPropsKeys.some(k => ['layoutMode', 'fills', 'gap', 'padding', 'width', 'height', 'fontSize', 'cornerRadius'].includes(k));
          console.log(`[generateDesign] ✅ Node "${node.id}" AFTER lifting — props keys (${finalPropsKeys.length}): [${finalPropsKeys.join(', ')}]${!hasStyling ? ' ⚠️ NO STYLING DETECTED' : ''}`);
        }

        // Reconstruct flat list → tree
        const reconstructor = new TreeReconstructor();
        const { root, errors: reconErrors, warnings: reconWarnings } = reconstructor.reconstruct(nodes);

        if (!root) {
          response = {
            success: false,
            error: {
              code: 'RECONSTRUCTION_FAILED',
              message: reconErrors.join('; ') || 'Failed to reconstruct node tree.'
            }
          };
          break;
        }

        if (reconWarnings.length > 0) {
          console.warn('[generateDesign] Reconstruction warnings:', reconWarnings);
        }

        // [DIAGNOSTIC] Verify root props survived reconstruction
        console.log(`[generateDesign] 🌳 Root after reconstruction — type: ${root.type}, props keys: [${Object.keys(root.props || {}).join(', ')}], children: ${root.children?.length || 0}`);

        // Render the full tree in one pass via the existing pipeline
        const rootNode = await handleUnifiedRender({
          ...root, // type, props, children — this is a valid NodeLayer
          designSystemId: context?.designSystemId || 'vanilla',
          streamSessionId: `generate-design-${Date.now()}`,
          meta: { traceId: `generate-design-${Date.now()}` }
        }, false);

        if (!rootNode) {
          response = {
            success: false,
            error: { code: 'RENDER_FAILED', message: 'Tree reconstructed but rendering failed.' }
          };
          break;
        }

        // Collect created node IDs for agent context - Concise version
        const idMap: Record<string, string> = {};
        const collectIds = (node: SceneNode, flatNodes: typeof nodes) => {
          // Identify which flat node this Figma node belongs to by checking name match
          const match = flatNodes.find(f => (f.props?.name || f.id) === node.name);
          if (match && !idMap[match.id]) {
            idMap[match.id] = node.id;
          }
          if ('children' in node) {
            for (const child of (node as FrameNode).children) {
              collectIds(child, flatNodes);
            }
          }
        };
        collectIds(rootNode, nodes);

        // Post-op anomaly detection on the full tree (zero-cost when clean)
        const treeAnomalies = collectTreeAnomalies(rootNode);

        response = {
          success: true,
          data: {
            rootNodeId: rootNode.id,
            totalNodes: Object.keys(idMap).length,
            idMap, // Logical ID -> Figma Node ID
            warnings: reconWarnings.length > 0 ? reconWarnings : undefined,
            anomalies: treeAnomalies.length > 0 ? treeAnomalies : undefined
          }
        };

        if (response.success && parameters.stepId) {
          planState.completeTask(parameters.stepId);
        }
        break;
      }

      // ==========================================
      // 11. Unknown Tool
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
        if (params?.stepId) planState.completeTask(params.stepId);
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
        if (params?.stepId) planState.completeTask(params.stepId);
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
        if (params?.stepId) planState.completeTask(params.stepId);
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
