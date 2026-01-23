/**
 * @file frameRenderer.ts
 * @description FRAME Node Renderer - Handles AutoLayout, sizing, fills, effects
 */

import { BaseRenderer, NodeLayer, RenderContext, LayoutMode, NodeLayerProps } from './baseRenderer';
import { PropertyTransformer } from '../propertyTransformer';
import { PROPS } from '../../../constants/figma-api';

/**
 * FrameRenderer - Renders FRAME nodes with AutoLayout support
 */
export class FrameRenderer extends BaseRenderer {
    private childRendererFn?: (dsl: NodeLayer, context: RenderContext) => Promise<SceneNode | null>;
    private readonly MAX_DEPTH = 15;

    constructor(createPaintFn: (color: string) => Promise<Paint | null>) {
        super(createPaintFn);
    }

    /**
     * Set the child renderer function (called by RendererFactory to break circular dependency)
     */
    setChildRenderer(fn: (dsl: NodeLayer, context: RenderContext) => Promise<SceneNode | null>): void {
        this.childRendererFn = fn;
    }

    protected getRendererName(): string {
        return 'FrameRenderer';
    }

    protected async createNode(dsl: NodeLayer): Promise<FrameNode> {
        return figma.createFrame();
    }

    protected async applyTypeSpecificProps(
        node: SceneNode,
        dsl: NodeLayer,
        context: RenderContext
    ): Promise<void> {
        const f = node as FrameNode;
        const props = dsl.props;

        // ========== Fills ==========
        await this.applyFills(f, props);

        // ========== AutoLayout ==========
        this.applyAutoLayout(f, props);

        // ========== Corner Radius ==========
        if (props.cornerRadius !== undefined && props.cornerRadius > 0) {
            f.cornerRadius = props.cornerRadius;
        }

        // ========== Corner Smoothing (iOS style) ==========
        if (props.cornerSmoothing !== undefined) {
            f.cornerSmoothing = props.cornerSmoothing;
        }

        // ========== Strokes ==========
        await this.applyStrokes(f, props);

        // ========== Effects (Shadows) ==========
        await this.applyEffects(f, props);

        // ========== Layout Sizing ==========
        this.applyLayoutSizing(f, dsl, context);
    }

    // ==========================================
    // PRIVATE HELPERS
    // ==========================================

    private async applyFills(f: FrameNode, props: NodeLayerProps): Promise<void> {
        const paints: Paint[] = [];

        // [FIX] Fallback to backgroundColor if fills is empty
        // Use type assertion to access backgroundColor since it might not be in strict schema but is in runtime props
        const bg = (props as any).backgroundColor;
        const sourceFills = (props.fills && props.fills.length > 0) ? props.fills : (bg ? [bg] : []);

        if (sourceFills.length > 0) {
            for (const fillColor of sourceFills) {
                const paint = await this.createPaintFn(fillColor);
                if (paint) paints.push(paint);
            }
            f.fills = paints;
        } else {
            f.fills = []; // Transparent
        }
    }

    private applyAutoLayout(f: FrameNode, props: NodeLayerProps): void {
        if (!props.layoutMode || props.layoutMode === 'NONE') return;

        f.layoutMode = props.layoutMode;
        f.itemSpacing = PropertyTransformer.deserialize(props.gap || 0, PROPS.gap);

        // Axis alignment
        if (props.primaryAxisAlignItems) {
            f.primaryAxisAlignItems = props.primaryAxisAlignItems;
        }
        if (props.counterAxisAlignItems) {
            f.counterAxisAlignItems = props.counterAxisAlignItems;
        }

        // Optimized Padding Application
        f.paddingTop = PropertyTransformer.deserialize(props.paddingTop || (props.padding as any)?.top || (typeof props.padding === 'number' ? props.padding : 0), PROPS.paddingTop);
        f.paddingRight = PropertyTransformer.deserialize(props.paddingRight || (props.padding as any)?.right || (typeof props.padding === 'number' ? props.padding : 0), PROPS.paddingRight);
        f.paddingBottom = PropertyTransformer.deserialize(props.paddingBottom || (props.padding as any)?.bottom || (typeof props.padding === 'number' ? props.padding : 0), PROPS.paddingBottom);
        f.paddingLeft = PropertyTransformer.deserialize(props.paddingLeft || (props.padding as any)?.left || (typeof props.padding === 'number' ? props.padding : 0), PROPS.paddingLeft);
    }

    private async applyStrokes(f: FrameNode, props: NodeLayerProps): Promise<void> {
        if (!props.strokes || props.strokes.length === 0) return;

        const strokePaints: Paint[] = [];
        for (const strokeColor of props.strokes) {
            const paint = await this.createPaintFn(strokeColor);
            if (paint) strokePaints.push(paint);
        }

        if (strokePaints.length > 0) {
            f.strokes = strokePaints;
            f.strokeWeight = props.strokeWeight || 1;
            f.strokeAlign = props.strokeAlign || 'INSIDE';
        }
    }

    private async applyEffects(f: FrameNode, props: NodeLayerProps): Promise<void> {
        if (!props.effects || !Array.isArray(props.effects)) return;

        const figmaEffects: Effect[] = [];

        for (const eff of props.effects) {
            const type = eff.type as string;
            if (type === 'DROP_SHADOW' || type === 'INNER_SHADOW') {
                // Use PropertyTransformer or keep local specialized logic if it involves createPaint-like complexity
                // But for effects, we currently use parseHexColor (simple RGB)
                // [PURE TRUST] Removed hardcoded shadow defaults (color #00000014, offset 0/4, blur 16)
                // If LLM doesn't provide them, Figma defaults or DS defaults should apply via context.
                const dslColor = eff.color;
                const { parseColor } = require('../../../utils/colorUtils');
                const colorRGBA = dslColor ? parseColor(dslColor) : { r: 0, g: 0, b: 0, a: 0.1 }; // Minimal safe default if totally missing

                figmaEffects.push({
                    type: type as 'DROP_SHADOW' | 'INNER_SHADOW',
                    color: colorRGBA,
                    offset: eff.offset || { x: 0, y: 0 },
                    radius: eff.radius || 0,
                    spread: (eff as any).spread || 0,
                    visible: (eff as any).visible !== false,
                    blendMode: ((eff as any).blendMode as BlendMode) || 'NORMAL'
                });
            }
        }

        if (figmaEffects.length > 0) {
            f.effects = figmaEffects;
        }
    }

    /**
     * Apply layout sizing mode and dimensions
     * 
     * ARCHITECTURE FIX: This method now correctly sets sizing mode BEFORE resize.
     * - Root nodes: Always FIXED with explicit dimensions
     * - Child nodes: Respect layoutSizingHorizontal/Vertical from DSL
     * - Only FIXED mode uses explicit width/height values
     */
    private applyLayoutSizing(f: FrameNode, dsl: NodeLayer, context: RenderContext): void {
        const props = dsl.props;
        const isRoot = context.depth === 0;
        const hasAutoLayout = props.layoutMode && props.layoutMode !== 'NONE';
        const parentHasAutoLayout = context.parentLayoutMode && context.parentLayoutMode !== 'NONE';
        
        // ========== 1. Determine Sizing Modes ==========
        let hSizing: 'FIXED' | 'HUG' | 'FILL' = props.layoutSizingHorizontal || 'HUG';
        let vSizing: 'FIXED' | 'HUG' | 'FILL' = props.layoutSizingVertical || 'HUG';
        
        // V6 FIX: Root nodes on a page CAN be HUG if they have AutoLayout
        // Only force FIXED if there's no layout mode
        if (isRoot && !hasAutoLayout) {
            hSizing = 'FIXED';
            vSizing = 'FIXED';
        }
        
        // CRITICAL: FILL can only be set on children of auto-layout frames
        // If parent doesn't have auto-layout, fallback FILL → FIXED for root or HUG for others
        if (!parentHasAutoLayout) {
            if (hSizing === 'FILL') hSizing = isRoot ? 'FIXED' : 'HUG';
            if (vSizing === 'FILL') vSizing = isRoot ? 'FIXED' : 'HUG';
        }
        
        // [PURE TRUST] Removed HUG/FILL paradox demotion. 
        // We trust the structure. If it causes a 1px collapse in Figma, it is valid feedback for the LLM.
        
        // If explicit dimensions provided without sizing mode, assume FIXED
        if (props.width && !props.layoutSizingHorizontal) {
            hSizing = 'FIXED';
        }
        if (props.height && !props.layoutSizingVertical) {
            vSizing = 'FIXED';
        }
        
        // ========== 2. Set Sizing Mode FIRST (before resize) ==========
        // [PURE TRUST] Removed Auto Layout enforcement.
        // If LLM requests HUG without Layout, we let Figma handle it (or error out).
        // This respects the "No Interference" policy.
        /*
        if ((hSizing === 'HUG' || vSizing === 'HUG') && (!f.layoutMode || f.layoutMode === 'NONE')) {
            console.warn(`[FrameRenderer] HUG requires auto-layout. Adding layoutMode=HORIZONTAL for "${props.name}"`);
            f.layoutMode = 'HORIZONTAL';
        }
        */
        
        // Figma root frames on page support HUG if layoutMode is set
        f.layoutSizingHorizontal = hSizing;
        f.layoutSizingVertical = vSizing;
        
        // ========== 3. Calculate Dimensions (only for FIXED mode) ==========
        let w: number;
        let h: number;
        
        if (hSizing === 'FIXED') {
            // [P7.2] Use viewport from context instead of hardcoded 360
            const viewportWidth = (context.viewport?.width) ?? (context.designSystem?.heuristics.heuristics.layout.containerWidth || 360);
            w = props.width || (isRoot ? viewportWidth : 1);
        } else {
            // For HUG/FILL, use a minimal initial size (Figma will expand)
            w = f.width || 1;
        }
        
        if (vSizing === 'FIXED') {
            // [P7.2] Use viewport from context instead of hardcoded 640
            const viewportHeight = (context.viewport?.height) ?? (context.designSystem?.heuristics.heuristics.layout.emptyHeight || 640);
            h = props.height || (isRoot ? viewportHeight : 1);
        } else {
            // For HUG/FILL, use a minimal initial size (Figma will expand)
            h = f.height || 1;
        }
        
        // ========== 4. Resize (required for FIXED mode) ==========
        if (hSizing === 'FIXED' || vSizing === 'FIXED' || isRoot) {
            f.resize(Math.max(1, w), Math.max(1, h));
        }
        
        // ========== 5. Apply Constraints (min/max) ==========
        // These work with FILL mode to provide bounds
        if (props.minWidth !== undefined && props.minWidth > 0) {
            f.minWidth = props.minWidth;
        }
        if (props.maxWidth !== undefined && props.maxWidth > 0) {
            f.maxWidth = props.maxWidth;
        }
        if (props.minHeight !== undefined && props.minHeight > 0) {
            f.minHeight = props.minHeight;
        }
        if (props.maxHeight !== undefined && props.maxHeight > 0) {
            f.maxHeight = props.maxHeight;
        }
        
        // ========== 6. Child-specific adjustments (Flex fallbacks) ==========
        if (!isRoot && parentHasAutoLayout) {
            // Primary Axis Growth
            if (context.parentLayoutMode === 'HORIZONTAL' && hSizing === 'FILL') f.layoutGrow = 1;
            if (context.parentLayoutMode === 'VERTICAL' && vSizing === 'FILL') f.layoutGrow = 1;
            
            // Counter Axis Stretching
            if (context.parentLayoutMode === 'HORIZONTAL' && vSizing === 'FILL') f.layoutAlign = 'STRETCH';
            if (context.parentLayoutMode === 'VERTICAL' && hSizing === 'FILL') f.layoutAlign = 'STRETCH';
        }
    }

    /**
     * Override to render children
     */
    protected async renderChildren(
        node: SceneNode,
        dsl: NodeLayer,
        context: RenderContext
    ): Promise<void> {
        if (!dsl.children || !('children' in node) || !this.childRendererFn) return;

        // Recursion Protection
        if (context.depth > this.MAX_DEPTH) {
            console.warn(`[FrameRenderer] Max depth ${this.MAX_DEPTH} reached. Skipping children of ${dsl.props.name}`);
            return;
        }

        const f = node as FrameNode;
        const childContext: RenderContext = {
            parent: f,
            depth: context.depth + 1,
            // [FIX] SSOT: Use actual node layout mode
            parentLayoutMode: f.layoutMode,
            // [P7.1] [FIX] SSOT: Use actual node sizing for HUG/FILL paradox detection
            parentSizingHorizontal: f.layoutSizingHorizontal,
            parentSizingVertical: f.layoutSizingVertical,
            // [P7.2] Pass viewport context through the tree
            viewport: context.viewport,
            designSystem: context.designSystem
        };

        for (const childDSL of dsl.children) {
            await this.childRendererFn(childDSL, childContext);
        }
    }
}
