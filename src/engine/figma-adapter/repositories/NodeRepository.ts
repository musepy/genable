/**
 * @file NodeRepository.ts
 * @description Repository layer for Figma Node operations.
 * 
 * [RESPONSIBILITY]: Encapsulate all direct Figma SDK calls related to nodes.
 * [PATTERN]: Repository Pattern - abstracts data access layer.
 * 
 * This isolates side effects (Figma SDK calls) from business logic,
 * making the code testable and the architecture layered.
 */

import { findNodeByIdAsync } from '../../pipeline/RenderOrchestrator';

export interface NodeLayoutConfig {
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE' | string;
  sizing?: {
    horizontal?: 'FIXED' | 'HUG' | 'FILL';
    vertical?: 'FIXED' | 'HUG' | 'FILL';
  };
  layoutGrow?: number;
  layoutAlign?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'INHERIT' | string;
  constraints?: {
    horizontal?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE' | string;
    vertical?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE' | string;
  };
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  gap?: number;
  padding?: {
    horizontal?: number;
    vertical?: number;
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };
}

export interface NodeStyleConfig {
  fills?: string[]; // Hex color strings
  strokes?: string[]; // Hex color strings
  strokeWeight?: number;
  cornerRadius?: number;
  opacity?: number;
}

export interface NodeInfo {
  id: string;
  name: string;
  type: string;
}

/**
 * Repository for Figma Node operations.
 * All direct figma.* node API calls go here.
 */
export class NodeRepository {
  /**
   * Find a node by ID (supports both semantic IDs and Figma IDs)
   */
  async findById(nodeId: string): Promise<SceneNode | null> {
    return findNodeByIdAsync(nodeId);
  }

  /**
   * Get current page selection
   */
  getSelection(): SceneNode[] {
    return [...figma.currentPage.selection];
  }

  /**
   * Get selection as simplified NodeInfo[]
   */
  getSelectionInfo(): NodeInfo[] {
    return figma.currentPage.selection.map(node => ({
      id: node.id,
      name: node.name,
      type: node.type
    }));
  }

  /**
   * Get selection count
   */
  getSelectionCount(): number {
    return figma.currentPage.selection.length;
  }

  /**
   * Remove a node from the canvas
   */
  removeNode(node: SceneNode): void {
    node.remove();
  }

  /**
   * Check if node can have children (type guard)
   */
  isContainer(node: SceneNode): node is FrameNode | ComponentNode | InstanceNode | GroupNode {
    return 'children' in node;
  }

  /**
   * Check if node is a frame or component (can have auto-layout)
   */
  isAutoLayoutContainer(node: SceneNode): node is FrameNode | ComponentNode {
    return node.type === 'FRAME' || node.type === 'COMPONENT';
  }

  /**
   * Get parent node if it's a container
   */
  getParentContainer(node: SceneNode): (FrameNode | ComponentNode | InstanceNode | GroupNode | PageNode) | null {
    const parent = node.parent;
    if (!parent) return null;
    if (parent.type === 'PAGE' || parent.type === 'FRAME' || parent.type === 'COMPONENT' || 
        parent.type === 'INSTANCE' || parent.type === 'GROUP') {
      return parent as FrameNode | ComponentNode | InstanceNode | GroupNode | PageNode;
    }
    return null;
  }

  /**
   * Apply layout configuration to a frame node
   */
  applyLayout(node: FrameNode | ComponentNode, config: NodeLayoutConfig): void {
    // Apply Layout Mode first (as it affects available sizing options)
    if (config.layoutMode !== undefined) {
      node.layoutMode = config.layoutMode;
    }

    const parent = this.getParentContainer(node);
    const parentIsAutoLayout = !!(
      parent &&
      parent.type !== 'PAGE' &&
      'layoutMode' in parent &&
      (parent as any).layoutMode !== 'NONE'
    );

    // Auto-layout child positioning override (ignore auto layout flow)
    if (config.layoutPositioning !== undefined && parentIsAutoLayout && 'layoutPositioning' in node) {
      const positioning = String(config.layoutPositioning).toUpperCase();
      (node as any).layoutPositioning = positioning === 'ABSOLUTE' ? 'ABSOLUTE' : 'AUTO';
    }

    // Apply Sizing
    if (config.sizing) {
      const { horizontal, vertical } = config.sizing;
      
      // Handle FIXED sizing with explicit dimensions
      if (horizontal === 'FIXED' && config.width !== undefined) {
        node.resize(config.width, node.height);
      }
      if (vertical === 'FIXED' && config.height !== undefined) {
        node.resize(node.width, config.height);
      }
      
      // Apply sizing modes
      if (horizontal !== undefined) {
        node.layoutSizingHorizontal = horizontal;
      }
      if (vertical !== undefined) {
        node.layoutSizingVertical = vertical;
      }
    }

    // Explicit dimensions can be applied independently from sizing updates.
    if (config.sizing === undefined && (config.width !== undefined || config.height !== undefined)) {
      node.resize(config.width ?? node.width, config.height ?? node.height);
    }

    // Apply explicit auto-layout child controls when relevant.
    if (parentIsAutoLayout) {
      if (config.layoutGrow !== undefined && 'layoutGrow' in node) {
        (node as any).layoutGrow = config.layoutGrow;
      }
      if (config.layoutAlign !== undefined && 'layoutAlign' in node) {
        (node as any).layoutAlign = this.normalizeLayoutAlign(config.layoutAlign);
      }
    }

    // Apply constraints for non-auto-layout positioning behavior (left/right/scale, etc.)
    if (config.constraints && 'constraints' in node) {
      const current = ((node as any).constraints || { horizontal: 'MIN', vertical: 'MIN' }) as Constraints;
      (node as any).constraints = {
        horizontal: this.normalizeConstraintAxis(config.constraints.horizontal, 'horizontal') || current.horizontal,
        vertical: this.normalizeConstraintAxis(config.constraints.vertical, 'vertical') || current.vertical
      } as Constraints;
    }

    // x/y are valid in non-auto-layout parents and in auto-layout only when child is ABSOLUTE.
    const isAbsoluteInAutoLayout = parentIsAutoLayout && (node as any).layoutPositioning === 'ABSOLUTE';
    const canSetXY = !parentIsAutoLayout || isAbsoluteInAutoLayout;
    if (canSetXY) {
      if (config.x !== undefined && 'x' in node) {
        (node as any).x = config.x;
      }
      if (config.y !== undefined && 'y' in node) {
        (node as any).y = config.y;
      }
    }

    // Apply Spacing (only valid if AutoLayout)
    if (node.layoutMode !== 'NONE') {
      if (config.gap !== undefined) {
        node.itemSpacing = config.gap;
      }
      
      if (config.padding) {
        const { padding } = config;
        
        if (padding.horizontal !== undefined) {
          node.paddingLeft = padding.horizontal;
          node.paddingRight = padding.horizontal;
        }
        if (padding.vertical !== undefined) {
          node.paddingTop = padding.vertical;
          node.paddingBottom = padding.vertical;
        }
        
        // Specific overrides
        if (padding.left !== undefined) node.paddingLeft = padding.left;
        if (padding.right !== undefined) node.paddingRight = padding.right;
        if (padding.top !== undefined) node.paddingTop = padding.top;
        if (padding.bottom !== undefined) node.paddingBottom = padding.bottom;
      }
    }
  }

  private normalizeConstraintAxis(
    value: string | undefined,
    axis: 'horizontal' | 'vertical'
  ): ConstraintType | undefined {
    if (!value) return undefined;
    const upper = String(value).toUpperCase();

    if (axis === 'horizontal') {
      const map: Record<string, ConstraintType> = {
        LEFT: 'MIN',
        RIGHT: 'MAX',
        LEFT_RIGHT: 'STRETCH'
      };
      return map[upper] || (upper as ConstraintType);
    }

    const map: Record<string, ConstraintType> = {
      TOP: 'MIN',
      BOTTOM: 'MAX',
      TOP_BOTTOM: 'STRETCH'
    };
    return map[upper] || (upper as ConstraintType);
  }

  private normalizeLayoutAlign(value: string): string {
    const upper = String(value).toUpperCase();
    const map: Record<string, string> = {
      LEFT: 'MIN',
      RIGHT: 'MAX',
      TOP: 'MIN',
      BOTTOM: 'MAX'
    };
    return map[upper] || upper;
  }

  /**
   * Apply styles to a node
   */
  applyStyles(
    node: SceneNode & GeometryMixin & BlendMixin & RectangleCornerMixin,
    config: NodeStyleConfig
  ): void {
    // Apply fills
    if (config.fills && config.fills.length > 0) {
      const paints = this.hexColorsToPaints(config.fills);
      if (paints.length > 0) {
        node.fills = paints as Paint[];
      }
    }

    // Apply strokes
    if (config.strokes && config.strokes.length > 0) {
      const paints = this.hexColorsToPaints(config.strokes);
      if (paints.length > 0) {
        node.strokes = paints as Paint[];
      }
    }

    // Apply other properties
    if (config.strokeWeight !== undefined && 'strokeWeight' in node) {
      (node as any).strokeWeight = config.strokeWeight;
    }
    if (config.cornerRadius !== undefined && 'cornerRadius' in node) {
      (node as any).cornerRadius = config.cornerRadius;
    }
    if (config.opacity !== undefined && 'opacity' in node) {
      node.opacity = config.opacity;
    }
  }

  /**
   * Convert hex color strings to Figma Paint objects
   */
  private hexColorsToPaints(colors: string[]): Paint[] {
    const paints: Paint[] = [];
    for (const color of colors) {
      if (typeof color === 'string' && color.startsWith('#') && color.length >= 7) {
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          paints.push({ type: 'SOLID', color: { r, g, b } });
        }
      }
    }
    return paints;
  }
}

// Export singleton instance
export const nodeRepository = new NodeRepository();
