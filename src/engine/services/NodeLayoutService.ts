/**
 * @file NodeLayoutService.ts
 * @description Service layer for node layout operations.
 * 
 * [RESPONSIBILITY]: Business logic and validation for node layout operations.
 * [PATTERN]: Service Layer - contains domain logic, delegates to repositories.
 * 
 * This service:
 * 1. Validates layout constraints before applying
 * 2. Orchestrates repository calls
 * 3. Returns structured results for IPC handlers
 */

import { nodeRepository, NodeLayoutConfig, NodeStyleConfig } from '../figma-adapter/repositories';
import { ToolResponse } from '../agent/tools/types';

export interface LayoutValidationError {
  code: string;
  message: string;
}

export interface LayoutResult {
  success: boolean;
  nodeId?: string;
  error?: LayoutValidationError;
}

/**
 * Service for node layout operations.
 * Encapsulates business logic and validation.
 */
export class NodeLayoutService {
  private repository = nodeRepository;

  /**
   * Validate layout constraints before applying.
   * This is where domain rules like "HUG requires Auto Layout" are enforced.
   *
   * HUG sizing is valid when:
   * 1. The node itself is becoming an Auto Layout container (layoutMode !== 'NONE'), OR
   * 2. The parent is an Auto Layout container
   *
   * This fixes the atomic tool chain issue where createNode -> setNodeLayout
   * would fail because the validation only checked parent context, not the
   * node's own intended layout mode.
   */
  validateLayoutConstraints(
    node: FrameNode | ComponentNode,
    config: NodeLayoutConfig
  ): LayoutValidationError | null {
    const parent = this.repository.getParentContainer(node);

    // Rule: HUG sizing requires Auto Layout context (either self or parent)
    if (config.sizing) {
      const { horizontal, vertical } = config.sizing;

      // Check if node itself is becoming Auto Layout (from config or current state)
      const isBecomingAutoLayout =
        config.layoutMode !== undefined
          ? config.layoutMode !== 'NONE'
          : node.layoutMode !== 'NONE';

      // Check if parent is Auto Layout
      const isParentAutoLayout = parent &&
        parent.type !== 'PAGE' &&
        (parent.type !== 'FRAME' || parent.layoutMode !== 'NONE');

      // Check Horizontal HUG constraint
      if (horizontal === 'HUG') {
        // HUG is valid if: (1) node is Auto Layout itself, OR (2) parent is Auto Layout
        if (!isBecomingAutoLayout && !isParentAutoLayout) {
          return {
            code: 'CONSTRAINT_VIOLATION',
            message: `HUG horizontal sizing requires Auto Layout context. ` +
                     `Either set layoutMode to VERTICAL/HORIZONTAL (making this node an Auto Layout container), ` +
                     `or ensure the parent '${parent?.name || 'unknown'}' has Auto Layout enabled.`
          };
        }
      }

      // Check Vertical HUG constraint
      if (vertical === 'HUG') {
        // HUG is valid if: (1) node is Auto Layout itself, OR (2) parent is Auto Layout
        if (!isBecomingAutoLayout && !isParentAutoLayout) {
          return {
            code: 'CONSTRAINT_VIOLATION',
            message: `HUG vertical sizing requires Auto Layout context. ` +
                     `Either set layoutMode to VERTICAL/HORIZONTAL (making this node an Auto Layout container), ` +
                     `or ensure the parent '${parent?.name || 'unknown'}' has Auto Layout enabled.`
          };
        }
      }
    }

    return null;
  }

  /**
   * Apply layout configuration to a node with validation.
   */
  async applyLayout(nodeId: string, config: NodeLayoutConfig): Promise<ToolResponse> {
    // 1. Find the node
    const node = await this.repository.findById(nodeId);
    
    if (!node) {
      return {
        success: false,
        error: { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` }
      };
    }

    // 2. Check if node supports layout
    if (!this.repository.isAutoLayoutContainer(node)) {
      return {
        success: false,
        error: { 
          code: 'INVALID_NODE_TYPE', 
          message: `Node ${nodeId} (${node.type}) does not support Auto Layout.` 
        }
      };
    }

    // 3. Validate constraints
    const validationError = this.validateLayoutConstraints(node, config);
    if (validationError) {
      return {
        success: false,
        error: validationError
      };
    }

    // 4. Apply layout
    try {
      this.repository.applyLayout(node, config);
      return {
        success: true,
        data: { nodeId: node.id }
      };
    } catch (e: any) {
      return {
        success: false,
        error: { code: 'APPLY_ERROR', message: e.message }
      };
    }
  }

  /**
   * Apply styles to a node.
   */
  async applyStyles(nodeId: string, config: NodeStyleConfig): Promise<ToolResponse> {
    const node = await this.repository.findById(nodeId);
    
    if (!node) {
      return {
        success: false,
        error: { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` }
      };
    }

    // Check if node supports styles
    const hasGeometry = 'fills' in node;
    const hasBlend = 'opacity' in node;
    const hasCorners = 'cornerRadius' in node;

    if (!hasGeometry || !hasBlend) {
      return {
        success: false,
        error: { 
          code: 'INVALID_NODE_TYPE', 
          message: `Node ${nodeId} (${node.type}) does not support styling.` 
        }
      };
    }

    try {
      this.repository.applyStyles(
        node as SceneNode & GeometryMixin & BlendMixin & RectangleCornerMixin,
        config
      );
      return {
        success: true,
        data: { nodeId: node.id }
      };
    } catch (e: any) {
      return {
        success: false,
        error: { code: 'APPLY_ERROR', message: e.message }
      };
    }
  }

  /**
   * Get current selection info.
   */
  getSelection(): { count: number; nodes: Array<{ id: string; name: string; type: string }> } {
    return {
      count: this.repository.getSelectionCount(),
      nodes: this.repository.getSelectionInfo()
    };
  }

  /**
   * Delete a node by ID.
   */
  async deleteNode(nodeId: string): Promise<ToolResponse> {
    const node = await this.repository.findById(nodeId);
    
    if (!node) {
      return {
        success: false,
        error: { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found.` }
      };
    }

    try {
      this.repository.removeNode(node);
      return { success: true };
    } catch (e: any) {
      return {
        success: false,
        error: { code: 'DELETE_ERROR', message: e.message }
      };
    }
  }

  /**
   * Resolve parent node for creation operations.
   */
  async resolveParent(parentId?: string): Promise<(BaseNode & ChildrenMixin) | null> {
    if (!parentId) return null;

    const parent = await this.repository.findById(parentId);
    if (parent && this.repository.isContainer(parent)) {
      return parent as (BaseNode & ChildrenMixin);
    }
    // Parent ID was provided but couldn't be resolved - potential node leaking
    if (parentId) {
      console.warn(`[NodeLayoutService] ⚠️ resolveParent failed: '${parentId}' ${parent ? 'is not a container' : 'not found'} - child will leak to page root`);
    }
    return null;
  }
}

// Export singleton instance
export const nodeLayoutService = new NodeLayoutService();
