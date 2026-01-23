/**
 * @file vectorRenderer.ts
 * @description VECTOR/RECTANGLE Node Renderer - Handles shapes and SVG content
 */

import { BaseRenderer, NodeLayer, RenderContext, NodeLayerProps } from './baseRenderer';
import { PropertyTransformer } from '../propertyTransformer';
import { PROPS } from '../../../constants/figma-api';

/**
 * VectorRenderer - Renders VECTOR, RECTANGLE nodes, and SVG content
 */
export class VectorRenderer extends BaseRenderer {
    constructor(createPaintFn: (color: string) => Promise<Paint | null>) {
        super(createPaintFn);
    }

    protected getRendererName(): string {
        return 'VectorRenderer';
    }

    protected async createNode(dsl: NodeLayer): Promise<SceneNode> {
        const props = dsl.props as NodeLayerProps & { svgContent?: string };
        
        // If svgContent is provided (from icon prefetcher), create from SVG
        if (props.svgContent) {
            try {
                const svgNode = figma.createNodeFromSvg(props.svgContent);
                console.log(`[VectorRenderer] Created SVG node: ${props.name || 'icon'}`);
                return svgNode;
            } catch (e) {
                console.error(`[VectorRenderer] Failed to create from SVG:`, e);
                // Fallback to rectangle
                return figma.createRectangle();
            }
        }
        
        // Default to Rectangle for simple shapes
        return figma.createRectangle();
    }

    protected async applyTypeSpecificProps(
        node: SceneNode,
        dsl: NodeLayer,
        context: RenderContext
    ): Promise<void> {
        const props = dsl.props as NodeLayerProps & { svgContent?: string };

        // For SVG nodes (FrameNode), just resize
        if (props.svgContent && node.type === 'FRAME') {
            if (props.width && props.height) {
                (node as FrameNode).resize(props.width, props.height);
            }
            // Apply fills to vector children
            if (props.fills && props.fills.length > 0) {
                await this.applyFillToSvgChildren(node as FrameNode, props.fills[0]);
            }
            return;
        }

        // For RectangleNode
        const r = node as RectangleNode;

        // ========== Fills ==========
        await this.applyFills(r, props);

        // ========== Corner Radius ==========
        if (props.cornerRadius !== undefined && props.cornerRadius > 0) {
            r.cornerRadius = PropertyTransformer.deserialize(props.cornerRadius, PROPS.cornerRadius);
        }

        // ========== Sizing & Layout Constraints (P0 FIX) ==========
        // Issue: Previous logic required BOTH width and height to be present,
        // causing 'FILL' items (which have no explicit width) to fail resizing/layout.
        
        // 1. Apply Layout Sizing Modes (if parent supports it)
        // Note: We cast to 'any' because strict typings sometimes miss layout props on Rectangles
        // in older API versions, but they are valid in runtime for AutoLayout children.
        if (props.layoutSizingHorizontal) {
            (r as any).layoutSizingHorizontal = props.layoutSizingHorizontal;
        }
        if (props.layoutSizingVertical) {
            (r as any).layoutSizingVertical = props.layoutSizingVertical;
        }

        // 2. Partial Resizing
        // If semantic 'h1' (height=1) is present but width is 'FILL' (undefined),
        // we must still apply the height constraint.
        const targetW = props.width ?? r.width;
        const targetH = props.height ?? r.height;

        if (props.width !== undefined || props.height !== undefined) {
            r.resize(targetW, targetH);
        }

        // ========== Strokes ==========
        if (props.strokes && props.strokes.length > 0) {
            const paints: Paint[] = [];
            for (const strokeColor of props.strokes) {
                const paint = await this.createPaintFn(strokeColor);
                if (paint) paints.push(paint);
            }
            r.strokes = paints;
            r.strokeWeight = PropertyTransformer.deserialize(props.strokeWeight || 1, PROPS.strokeWeight);
            r.strokeAlign = (props.strokeAlign as any) || 'INSIDE';
        }
    }

    private async applyFills(r: RectangleNode, props: NodeLayerProps): Promise<void> {
        if (!props.fills || props.fills.length === 0) return;

        const paints: Paint[] = [];
        for (const fillColor of props.fills) {
            const paint = await this.createPaintFn(fillColor);
            if (paint) paints.push(paint);
        }

        if (paints.length > 0) {
            r.fills = paints;
        }
    }

    private async applyFillToSvgChildren(frame: FrameNode, colorStr: string): Promise<void> {
        const paint = await this.createPaintFn(colorStr);
        if (!paint) return;

        // V5.4: Use shared Surgical Binding logic
        // This ensures consistency with IconRenderer and prevents future divergence.
        const { applySurgicalBinding } = await import('./surgicalBinding');
        applySurgicalBinding(frame, paint);
    }

}

