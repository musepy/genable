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

import type {
    NodeLayer,
    LayoutSizing,
    LayoutMode
} from '../../../schema/layerSchema';
import { PropertyTransformer } from '../propertyTransformer';
import { extractFigmaNodeData } from '../figmaNodeData';
import { PROP_METADATA, PROPS } from '../../../constants/figma-api';
import { findNodeById, registerNode } from '../../pipeline/RenderOrchestrator';
import { renderNodeDSL } from './index';

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
    parent: (SceneNode & ChildrenMixin) | PageNode;
    depth: number;
    parentLayoutMode?: 'VERTICAL' | 'HORIZONTAL' | 'NONE';
    designSystem?: import('../../../types/designSystem').DesignSystemConfig;
    viewport?: {
        width: number;
        height: number;
        isMobile: boolean;
    };
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
     * The main render method - Reconciliation Lifecycle (V7)
     */
    async render(dsl: NodeLayer, context: RenderContext): Promise<SceneNode | null> {
        try {
            // [V7] STEP 1: Find or Create
            let node = dsl.id ? findNodeById(dsl.id) : null;
            let isNew = false;

            if (node) {
                try {
                    // Type mismatch check - if type changed, we must recreate
                    const expectedType = this.getExpectedFigmaType(dsl.type);
                    if (node.removed || node.type !== expectedType) {
                        if (!node.removed) node.remove();
                        node = await this.createNode(dsl);
                        isNew = true;
                    }
                } catch (e) {
                    node = await this.createNode(dsl);
                    isNew = true;
                }
            } else {
                node = await this.createNode(dsl);
                isNew = true;
            }

            if (!node) return null;

            // [V7] STEP 2: Registry Sync
            if (dsl.id) registerNode(dsl.id, node);

            // [V7] STEP 3: Structural Integration
            // Always ensure the node is attached to the correct parent.
            // Figma's appendChild handles moving the node if it's already attached elsewhere.
            if ('appendChild' in context.parent && node.parent !== context.parent) {
                context.parent.appendChild(node);
            }

            // [V7] STEP 4: Property Application (Patching)
            // We apply common and specific props. 
            // The renderers themselves handle the "Diff" by only writing if needed (SSOT).
            await this.applyCommonProps(node, dsl, context);
            await this.applyTypeSpecificProps(node, dsl, context);

            // [V7] STEP 5: Render children recursively
            await this.renderChildren(node, dsl, context);

            return node;
        } catch (error) {
            console.warn(`[${this.getRendererName()}] Render failed:`, error);
            return null;
        }
    }

    /**
     * Helper to map DSL types to Figma types for reconciliation matching
     */
    private getExpectedFigmaType(dslType: string): string {
        const map: Record<string, string> = {
            'FRAME': 'FRAME', 'TEXT': 'TEXT', 'VECTOR': 'VECTOR', 'RECTANGLE': 'RECTANGLE',
            'LINE': 'LINE', 'ELLIPSE': 'ELLIPSE', 'GROUP': 'GROUP', 'SECTION': 'SECTION', 'ICON': 'FRAME'
        };
        return map[dslType] || 'FRAME';
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
        
        // [V8] Extract node data IR for diffing
        const nodeData = extractFigmaNodeData(node, Object.values(PROP_METADATA).map(m => m.figmaKey));

        commonProps.forEach(dslKey => {
            if (props[dslKey] !== undefined) {
                const meta = PROP_METADATA[dslKey];
                if (meta && meta.figmaKey in node) {
                    try {
                        // [V7] DIFF CHECK: Only write if value actually changed
                        if (PropertyTransformer.isEqual(nodeData, dslKey, props[dslKey])) {
                            return;
                        }

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
