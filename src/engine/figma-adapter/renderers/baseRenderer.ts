/**
 * @file baseRenderer.ts
 * @description Abstract Base Renderer - Strategy Pattern for Figma Node Rendering
 * 
 * [INPUT]:  NodeLayer DSL (from postProcessor)
 * [OUTPUT]: Figma SceneNode
 * [POS]:    Renderers - called by RendererFactory in main.ts
 * 
 * This base class defines the contract that all renderers must implement.
 * Each concrete renderer (Frame, Text, Vector) handles its specific node type.
 */

// ==========================================
// TYPES (Imported from Schema - Single Source of Truth)
// ==========================================

import {
    NodeLayer,
    LayoutSizing,
    LayoutMode
} from '../../../schema/layerSchema';
import { PropertyTransformer } from '../propertyTransformer';
import { PROP_METADATA, PROPS } from '../../../constants/figma-api';

export type {
    NodeLayer,
    LayoutSizing,
    LayoutMode
} from '../../../schema/layerSchema';

// Redundant alias removed
export type NodeLayerProps = NodeLayer['props'];

/**
 * Render context passed to renderers
 * [P7] Extended with viewport and parentSizing for architecture fixes
 */
export interface RenderContext {
    parent: SceneNode & ChildrenMixin;
    depth: number;
    parentLayoutMode?: 'VERTICAL' | 'HORIZONTAL' | 'NONE';
    // [P7.1] Parent sizing mode for HUG/FILL paradox detection
    parentSizingHorizontal?: 'HUG' | 'FILL' | 'FIXED';
    parentSizingVertical?: 'HUG' | 'FILL' | 'FIXED';
    // [P7.2] Viewport context for root node sizing (replaces hardcoded 360x640)
    viewport?: {
        width: number;
        height: number;
        isMobile: boolean;
    };
    // [P8] Explicit Design System Context for Renderers
    designSystem?: import('../../../types/designSystem').DesignSystemConfig;
}


// ==========================================
// ABSTRACT BASE RENDERER
// ==========================================

/**
 * Abstract base class for all renderers.
 * Implements the Template Method pattern for common rendering logic.
 */
export abstract class BaseRenderer {
    protected createPaintFn: (color: string) => Promise<Paint | null>;

    constructor(createPaintFn: (color: string) => Promise<Paint | null>) {
        this.createPaintFn = createPaintFn;
    }

    /**
     * The main render method - Template Method pattern
     */
    async render(dsl: NodeLayer, context: RenderContext): Promise<SceneNode | null> {
        try {
            // 1. Create the Figma node
            const node = await this.createNode(dsl);
            if (!node) return null;

            // 2. Add to parent BEFORE property application
            // This allows properties like layoutSizing="FILL" to validate correctly in Figma
            context.parent.appendChild(node);

            // 3. Apply common properties
            await this.applyCommonProps(node, dsl, context);

            // 4. Apply type-specific properties (now safe for layout sizing)
            await this.applyTypeSpecificProps(node, dsl, context);

            // 5. Render children recursively
            await this.renderChildren(node, dsl, context);

            return node;
        } catch (error) {
            console.warn(`[${this.getRendererName()}] Render failed:`, error);
            return null;
        }
    }

    // ==========================================
    // ABSTRACT METHODS (must be implemented)
    // ==========================================

    /**
     * Create the specific Figma node type
     */
    protected abstract createNode(dsl: NodeLayer): Promise<SceneNode | null>;

    /**
     * Apply properties specific to this node type
     */
    protected abstract applyTypeSpecificProps(
        node: SceneNode,
        dsl: NodeLayer,
        context: RenderContext
    ): Promise<void>;

    /**
     * Get the renderer name for logging
     */
    protected abstract getRendererName(): string;

    // ==========================================
    // COMMON IMPLEMENTATIONS
    // ==========================================

    /**
     * Apply properties common to all node types
     */
    protected async applyCommonProps(node: SceneNode, dsl: NodeLayer, context: RenderContext): Promise<void> {
        // [SAFETY FIX] Ensure props exists even if coercion fails for any reason
        const props = dsl.props || (dsl as any).properties || {};

        // 1. Unified Property Application (Scalar & Enum)
        // We handle standard common props using the Transformer
        const commonProps = [PROPS.name, PROPS.visible, PROPS.opacity, PROPS.rotation];
        
        commonProps.forEach(dslKey => {
            if (props[dslKey] !== undefined) {
                const meta = PROP_METADATA[dslKey];
                if (meta && meta.figmaKey in node) {
                    try {
                        const figmaValue = PropertyTransformer.deserialize(props[dslKey], dslKey);
                        (node as any)[meta.figmaKey] = figmaValue;
                    } catch (e) {
                         console.warn(`[BaseRenderer] Failed to apply ${dslKey}:`, e);
                    }
                }
            }
        });

        // 2. Archetype Detection (If name is default or missing)
        if ((!props.name || props.name === 'Node') && dsl.type === 'FRAME') {
            const archetypeName = this.detectArchetype(dsl);
            if (archetypeName) {
                node.name = archetypeName;
            } else if (props.layoutMode === 'HORIZONTAL') {
                node.name = 'Row';
            } else if (props.layoutMode === 'VERTICAL') {
                node.name = 'Column';
            } else if (props.fills && props.fills.length > 0) {
                node.name = 'Card';
            }
        }

        // 3. Blend Mode (Special case or add to metadata)
        if ((props as any).blendMode && 'blendMode' in node) {
            (node as any).blendMode = (props as any).blendMode as BlendMode;
        }
    }

    /**
     * Detect semantic archetypes based on structure and children
     */
    private detectArchetype(dsl: NodeLayer): string | null {
        const children = dsl.children || [];
        const props = dsl.props;

        const hasIcon = children.some((c: NodeLayer) => c.type === 'ICON' || c.type === 'VECTOR');
        const hasText = children.some((c: NodeLayer) => c.type === 'TEXT');
        const textNodes = children.filter((c: NodeLayer) => c.type === 'TEXT');

        // Pattern 1: InputWrapper (Icon + Text inside a bordered/filled frame)
        if (hasText && (props.strokeWeight || (props.fills && props.fills.length > 0))) {
            if (hasIcon || children.length === 1) return 'InputWrapper';
        }

        // Pattern 2: FieldHeader (Label + Action link)
        if (props.layoutMode === 'HORIZONTAL' && textNodes.length >= 2) {
            return 'FieldHeader';
        }

        // Pattern 3: IconGroup
        if (children.length > 1 && children.every((c: NodeLayer) => c.type === 'ICON' || c.type === 'VECTOR')) {
            return 'IconGroup';
        }

        // Pattern 4: MetricCard/Stat
        if (props.layoutMode === 'VERTICAL' && textNodes.length >= 2 && (props.fills && props.fills.length > 0)) {
            return 'MetricCard';
        }

        return null;
    }

    /**
     * Render children recursively
     * Override in FrameRenderer to actually render children
     */
    protected async renderChildren(
        node: SceneNode,
        dsl: NodeLayer,
        context: RenderContext
    ): Promise<void> {
        // Default: do nothing (TEXT and VECTOR don't have children)
    }
}
