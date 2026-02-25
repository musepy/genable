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
import { findNodeByIdAsync, registerNode } from '../../pipeline/RenderOrchestrator';
import { renderNodeDSL } from './index';
import { parseColor } from '../../../utils/colorUtils';

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
    protected createPaintFn: (color: string | Record<string, any>) => Promise<Paint | null>;

    constructor(createPaintFn: (color: string | Record<string, any>) => Promise<Paint | null>) {
        this.createPaintFn = createPaintFn;
    }

    /**
     * The main render method - Reconciliation Lifecycle (V7)
     */
    async render(dsl: NodeLayer, context: RenderContext): Promise<SceneNode | null> {
        try {
            // [V7] STEP 1: Find or Create
            let node = dsl.id ? await findNodeByIdAsync(dsl.id) : null;
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

        // 4. Positioning & Constraints
        this.applyPositioningAndConstraints(node, props, context);
    }

    /**
     * Apply visual effects (Shadows, Blurs)
     */
    protected async applyEffects(node: SceneNode, props: NodeLayerProps): Promise<void> {
        if (!('effects' in node) || !props.effects || !Array.isArray(props.effects)) return;

        const figmaEffects: Effect[] = [];
        // [V8] Core color utility for effect colors

        for (const eff of props.effects) {
            const type = (eff as any).effectType || (eff as any).type as string;
            
            if (type === 'DROP_SHADOW' || type === 'INNER_SHADOW') {
                const dslColor = eff.color;
                // Default to subtle shadow if color missing
                const colorRGBA = dslColor ? parseColor(dslColor) : { r: 0, g: 0, b: 0, a: 0.1 };

                figmaEffects.push({
                    type: type as 'DROP_SHADOW' | 'INNER_SHADOW',
                    color: colorRGBA,
                    offset: eff.offset || { x: 0, y: 0 },
                    radius: (eff as any).blur ?? (eff as any).radius ?? 0, // DSL 'blur' -> Figma 'radius'
                    spread: (eff as any).spread || 0,
                    visible: (eff as any).visible !== false,
                    blendMode: ((eff as any).blendMode as BlendMode) || 'NORMAL'
                });
            } else if (type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR') {
                figmaEffects.push({
                    type: type as 'LAYER_BLUR' | 'BACKGROUND_BLUR',
                    radius: (eff as any).blur ?? (eff as any).radius ?? 0, // DSL 'blur' -> Figma 'radius'
                    visible: (eff as any).visible !== false
                });
            }
        }

        if (figmaEffects.length > 0) {
            (node as any).effects = figmaEffects;
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

    /**
     * Apply absolute positioning, constraints, and auto-layout child overrides.
     * Supports:
     * - Non-auto-layout parent with precise x/y
     * - Auto-layout parent + ABSOLUTE child (ignore auto layout flow)
     * - Constraint aliases like LEFT/RIGHT/TOP/BOTTOM
     */
    private applyPositioningAndConstraints(node: SceneNode, props: NodeLayerProps, context: RenderContext): void {
        const parentIsAutoLayout = context.parentLayoutMode !== undefined && context.parentLayoutMode !== 'NONE';
        const rawPositioning = (props as any).layoutPositioning;
        const normalizedPositioning = this.normalizeLayoutPositioning(rawPositioning);

        if (parentIsAutoLayout && normalizedPositioning && 'layoutPositioning' in node) {
            try {
                (node as any).layoutPositioning = normalizedPositioning;
            } catch (e) {
                console.warn(`[BaseRenderer] Failed to apply layoutPositioning on "${node.name}":`, e);
            }
        }

        const constraints = (props as any).constraints;
        if (constraints && typeof constraints === 'object' && 'constraints' in node) {
            const existing = ((node as any).constraints || { horizontal: 'MIN', vertical: 'MIN' }) as {
                horizontal: ConstraintType;
                vertical: ConstraintType;
            };

            const horizontal = this.normalizeConstraintAxis(constraints.horizontal, 'horizontal') as ConstraintType | undefined;
            const vertical = this.normalizeConstraintAxis(constraints.vertical, 'vertical') as ConstraintType | undefined;
            const normalized: Constraints = {
                horizontal: horizontal || existing.horizontal,
                vertical: vertical || existing.vertical
            };

            try {
                (node as any).constraints = normalized;
            } catch (e) {
                console.warn(`[BaseRenderer] Failed to apply constraints on "${node.name}":`, e);
            }
        }

        const parsedX = this.parseNumberish((props as any).x);
        const parsedY = this.parseNumberish((props as any).y);
        const canPosition = 'x' in node && 'y' in node;

        if (canPosition && (parsedX !== undefined || parsedY !== undefined)) {
            const isAbsoluteInAutoLayout = parentIsAutoLayout && (
                ((node as any).layoutPositioning === 'ABSOLUTE') ||
                normalizedPositioning === 'ABSOLUTE'
            );
            const canSetXY = !parentIsAutoLayout || isAbsoluteInAutoLayout;

            if (canSetXY) {
                try {
                    if (parsedX !== undefined) (node as any).x = parsedX;
                    if (parsedY !== undefined) (node as any).y = parsedY;
                } catch (e) {
                    console.warn(`[BaseRenderer] Failed to apply x/y on "${node.name}":`, e);
                }
            }
        }

        // Explicit auto-layout child alignment controls
        if (parentIsAutoLayout && (node as any).layoutPositioning !== 'ABSOLUTE') {
            const layoutGrow = this.parseNumberish((props as any).layoutGrow);
            if (layoutGrow !== undefined && 'layoutGrow' in node) {
                try {
                    (node as any).layoutGrow = layoutGrow;
                } catch (e) {
                    console.warn(`[BaseRenderer] Failed to apply layoutGrow on "${node.name}":`, e);
                }
            }

            const layoutAlign = this.normalizeConstraintAxis((props as any).layoutAlign, 'align');
            if (layoutAlign && 'layoutAlign' in node) {
                try {
                    (node as any).layoutAlign = layoutAlign;
                } catch (e) {
                    console.warn(`[BaseRenderer] Failed to apply layoutAlign on "${node.name}":`, e);
                }
            }
        }
    }

    private normalizeLayoutPositioning(value: any): 'AUTO' | 'ABSOLUTE' | undefined {
        if (value === undefined || value === null) return undefined;
        const upper = String(value).toUpperCase();
        if (upper === 'ABSOLUTE') return 'ABSOLUTE';
        if (upper === 'AUTO' || upper === 'RELATIVE') return 'AUTO';
        return undefined;
    }

    private normalizeConstraintAxis(
        value: any,
        axis: 'horizontal' | 'vertical' | 'align'
    ): string | undefined {
        if (value === undefined || value === null) return undefined;
        const upper = String(value).toUpperCase();

        if (axis === 'horizontal') {
            const map: Record<string, string> = {
                LEFT: 'MIN',
                RIGHT: 'MAX',
                LEFT_RIGHT: 'STRETCH'
            };
            return map[upper] || upper;
        }

        if (axis === 'vertical') {
            const map: Record<string, string> = {
                TOP: 'MIN',
                BOTTOM: 'MAX',
                TOP_BOTTOM: 'STRETCH'
            };
            return map[upper] || upper;
        }

        const alignMap: Record<string, string> = {
            LEFT: 'MIN',
            RIGHT: 'MAX',
            TOP: 'MIN',
            BOTTOM: 'MAX'
        };
        return alignMap[upper] || upper;
    }

    private parseNumberish(value: any): number | undefined {
        if (value === undefined || value === null || value === '') return undefined;
        if (typeof value === 'number') return isNaN(value) ? undefined : value;
        if (typeof value === 'string' && !value.startsWith('$')) {
            const parsed = parseFloat(value);
            return isNaN(parsed) ? undefined : parsed;
        }
        return undefined;
    }
}
