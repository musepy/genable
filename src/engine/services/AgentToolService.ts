import { ToolResponse } from '../../engine/agent/tools/types';
import { nodeLayoutService } from './NodeLayoutService';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { handleUnifiedRender } from '../../ipc/helpers/renderHelper';
import { validateVisibility } from '../../engine/validation/visibilityValidator';
import { TreeReconstructor } from '../../engine/figma-adapter/treeReconstructor';
import { validatePostOp, collectTreeAnomalies } from '../../engine/validation/postOpValidator';
import { shouldSkipIdempotent, completeStep } from '../../ipc/helpers/idempotentApply';
import { deepMerge } from '../../utils/objectUtils';
import { logger } from '../../utils/logger';

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
 * Service to handle complex agent tool calls, encapsulating logic for lifting,
 * reconstructing, rendering, and validating mutations.
 * Serves as the domain boundary between IPC and Figma execution.
 */
class AgentToolService {

  // ==========================================
  // Private Utilities
  // ==========================================

  /**
   * Cleans up raw LLM design JSON, moving style/layout properties into the `props` object.
   */
  private normalizeDSL(nodes: any[]) {
    // Known style/layout properties that belong inside props.
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

    for (const node of nodes) {
      if (!node.props) node.props = {};

      const rawNodeKeys = Object.keys(node).filter(k => k !== 'id' && k !== 'parent' && k !== 'type' && k !== 'props');
      const rawPropsKeys = Object.keys(node.props);
      if (rawNodeKeys.length > 0 || rawPropsKeys.length <= 1) {
        logger.debug(`[generateDesign] 🔍 Node "${node.id}" BEFORE lifting — top-level keys: [${rawNodeKeys.join(', ')}], props keys: [${rawPropsKeys.join(', ')}]`);
      }

      // 1. Lift from props.layout/props.styles
      if (node.props.layout && typeof node.props.layout === 'object') {
        Object.assign(node.props, node.props.layout);
        delete node.props.layout;
      }
      if (node.props.styles && typeof node.props.styles === 'object') {
        Object.assign(node.props, node.props.styles);
        delete node.props.styles;
      }

      // 2. Lift from top-level node.layout/node.styles/node.style
      const topLevelLayout = (node as any).layout;
      const topLevelStyles = (node as any).styles || (node as any).style;
      
      if (topLevelLayout && typeof topLevelLayout === 'object') {
        logger.debug(`[generateDesign] Lifting top-level layout for node: ${node.id}`);
        Object.assign(node.props, topLevelLayout);
        delete (node as any).layout;
      }
      if (topLevelStyles && typeof topLevelStyles === 'object') {
        logger.debug(`[generateDesign] Lifting top-level styles for node: ${node.id}`);
        Object.assign(node.props, topLevelStyles);
        delete (node as any).styles;
        delete (node as any).style;
      }

      // 3. Lift known style properties found on the node top-level into props
      for (const key of KNOWN_STYLE_KEYS) {
        if ((node as any)[key] !== undefined && node.props[key] === undefined) {
          logger.debug(`[generateDesign] ⚠️ Safety net: lifting "${key}" from node top-level to props for "${node.id}"`);
          node.props[key] = (node as any)[key];
          delete (node as any)[key];
        }
      }

      // Ensure name fallback to id
      if (!node.props.name && node.id) {
        node.props.name = node.id;
      }

      const finalPropsKeys = Object.keys(node.props);
      const hasStyling = finalPropsKeys.some(k => ['layoutMode', 'fills', ' gap', 'padding', 'width', 'height', 'fontSize', 'cornerRadius'].includes(k));
      logger.debug(`[generateDesign] ✅ Node "${node.id}" AFTER lifting — props keys (${finalPropsKeys.length}): [${finalPropsKeys.join(', ')}]${!hasStyling ? ' ⚠️ NO STYLING DETECTED' : ''}`);
    }
  }

  // ==========================================
  // Execution Methods
  // ==========================================

  async createNode(parameters: any, designSystemId?: string): Promise<ToolResponse> {
    const { type, name, parentId, characters, props: flatProps, stepId, layout, styles } = parameters;
    const explicitParent = await nodeLayoutService.resolveParent(parentId);
    
    const node = await handleUnifiedRender({
      type,
      props: { 
        name: name || 'unnamed', 
        characters: characters || '',
        ...sanitizeFlatProps(flatProps)
      },
      designSystemId: designSystemId || 'vanilla',
      streamSessionId: 'agent-' + Date.now(),
      meta: { traceId: 'agent-atomic-tool' }
    }, false, explicitParent);
    
    let visibilityWarnings: any[] = [];
    let autoFixed: string[] = [];
    
    if (node) {
      if (layout) await nodeLayoutService.applyLayout(node.id, layout);
      if (styles) await nodeLayoutService.applyStyles(node.id, styles);
      
      const visResult = validateVisibility(node);
      if (!visResult.valid) {
        visResult.issues.filter(i => i.severity === 'error').forEach(i => i.autoFix?.());
        visibilityWarnings = visResult.issues.filter(i => i.severity === 'warning');
        autoFixed = visResult.autoFixed;
      }
    }
    
    const anomalies = node ? validatePostOp(node, sanitizeFlatProps(flatProps)) : [];

    const response: ToolResponse = {
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
    if (node) completeStep(stepId);
    return response;
  }

  async patchNode(parameters: any, designSystemId?: string): Promise<ToolResponse> {
    const { nodeId, props, stepId } = parameters;

    if (!nodeId || !props || Object.keys(props).length === 0) {
      return { success: false, error: { code: 'INVALID_INPUT', message: 'patchNode requires nodeId and non-empty props.' } };
    }

    const skipCheck = shouldSkipIdempotent(nodeId, 'properties', props, stepId);
    if (skipCheck.skip) return skipCheck.response;

    const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
    if (!node) {
      return { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` } };
    }

    const currentDSL = NodeSerializer.serialize(node);
    const mergedProps = deepMerge(currentDSL.props || {}, props);

    const result = await handleUnifiedRender({
      ...currentDSL,
      props: mergedProps,
      __modifyMode: 'UPDATE',
      __modifyTargetId: nodeId,
      designSystemId: designSystemId || 'vanilla',
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

    const response: ToolResponse = {
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
    return response;
  }

  async updateNodeProperties(parameters: any, designSystemId?: string): Promise<ToolResponse> {
    const { nodeId, properties, stepId } = parameters;

    const propsSkip = shouldSkipIdempotent(nodeId, 'properties', properties, stepId);
    if (propsSkip.skip) return propsSkip.response;

    const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
    if (!node) {
      return { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` } };
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
      designSystemId: designSystemId || 'vanilla',
      streamSessionId: 'agent-update-' + Date.now(),
      meta: { traceId: 'agent-tool' }
    }, false, node.parent as any);
    
    const response: ToolResponse = { 
      success: !!result, 
      data: { 
        nodeId: nodeId,
        modified: true,
        note: 'Properties updated successfully. Continue using the same nodeId.' 
      } 
    };

    if (response.success) completeStep(stepId);
    return response;
  }

  async renderSubtree(parameters: any, designSystemId?: string): Promise<ToolResponse> {
    const { nodes, parentId, stepId } = parameters;

    if (!Array.isArray(nodes) || nodes.length === 0) {
      return { success: false, error: { code: 'INVALID_INPUT', message: 'renderSubtree requires a non-empty nodes array' } };
    }

    const reconstructor = new TreeReconstructor();
    const { root, errors, warnings } = reconstructor.reconstruct(nodes);

    if (!root) {
      return { success: false, error: { code: 'RECONSTRUCTION_FAILED', message: errors.join('; ') || 'Failed to reconstruct subtree' } };
    }

    const explicitParent = await nodeLayoutService.resolveParent(parentId);

    const node = await handleUnifiedRender({
      ...root,
      designSystemId: designSystemId || 'vanilla',
      streamSessionId: 'agent-subtree-' + Date.now(),
      meta: { traceId: 'agent-tool' }
    }, false, explicitParent);

    let visibilityWarnings: any[] = [];
    let autoFixed: string[] = [];

    if (node) {
      const visResult = validateVisibility(node);
      if (!visResult.valid) {
        visResult.issues.filter(i => i.severity === 'error').forEach(i => i.autoFix?.());
        visibilityWarnings = visResult.issues.filter(i => i.severity === 'warning');
        autoFixed = visResult.autoFixed;
      }
    }

    const response: ToolResponse = {
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
    return response;
  }

  async createIcon(parameters: any, designSystemId?: string): Promise<ToolResponse> {
    const { iconName, size, color, parentId, props: flatProps, layout, styles, stepId } = parameters;
    const explicitParent = await nodeLayoutService.resolveParent(parentId);
    
    const sanitized = sanitizeFlatProps(flatProps);
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
      designSystemId: designSystemId || 'vanilla',
      streamSessionId: 'agent-' + Date.now(),
      meta: { traceId: 'agent-tool' }
    }, false, explicitParent);
    
    if (node) {
      if (layout) await nodeLayoutService.applyLayout(node.id, layout);
      if (styles) await nodeLayoutService.applyStyles(node.id, styles);
    }
    
    const response: ToolResponse = { success: !!node, data: { nodeId: node?.id } };
    if (node) completeStep(stepId);
    return response;
  }

  async generateDesign(parameters: any, designSystemId?: string): Promise<ToolResponse> {
    const { nodes, stepId } = parameters;

    if (!Array.isArray(nodes) || nodes.length === 0) {
      return { success: false, error: { code: 'INVALID_INPUT', message: 'generateDesign requires a non-empty nodes array.' } };
    }

    this.normalizeDSL(nodes);

    const reconstructor = new TreeReconstructor();
    const { root, errors: reconErrors, warnings: reconWarnings } = reconstructor.reconstruct(nodes);

    if (!root) {
      return {
        success: false,
        error: { code: 'RECONSTRUCTION_FAILED', message: reconErrors.join('; ') || 'Failed to reconstruct node tree.' }
      };
    }

    if (reconWarnings.length > 0) {
      logger.warn('[generateDesign] Reconstruction warnings:', reconWarnings);
    }

    const rootNode = await handleUnifiedRender({
      ...root,
      designSystemId: designSystemId || 'vanilla',
      streamSessionId: `generate-design-${Date.now()}`,
      meta: { traceId: `generate-design-${Date.now()}` }
    }, false);

    if (!rootNode) {
      return { success: false, error: { code: 'RENDER_FAILED', message: 'Tree reconstructed but rendering failed.' } };
    }

    const idMap: Record<string, string> = {};
    const collectIds = (node: SceneNode, flatNodes: typeof nodes) => {
      const match = flatNodes.find((f: any) => (f.props?.name || f.id) === node.name);
      if (match && !idMap[match.id]) idMap[match.id] = node.id;
      if ('children' in node) {
        for (const child of (node as FrameNode).children) collectIds(child, flatNodes);
      }
    };
    collectIds(rootNode, nodes);

    const treeAnomalies = collectTreeAnomalies(rootNode);

    const response: ToolResponse = {
      success: true,
      data: {
        rootNodeId: rootNode.id,
        totalNodes: Object.keys(idMap).length,
        idMap,
        warnings: reconWarnings.length > 0 ? reconWarnings : undefined,
        anomalies: treeAnomalies.length > 0 ? treeAnomalies : undefined
      }
    };

    return response;
  }
}

export const agentToolService = new AgentToolService();
