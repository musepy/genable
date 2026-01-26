import { BaseRenderer, NodeLayer, RenderContext } from './baseRenderer';
import { PropertyTransformer } from '../propertyTransformer';
import { PROPS } from '../../../constants/figma-api';

/**
 * ShapeRenderer - Specialized renderer for ELLIPSE and LINE nodes
 */
export class ShapeRenderer extends BaseRenderer {
    protected getRendererName(): string {
        return 'ShapeRenderer';
    }

    protected async createNode(dsl: NodeLayer): Promise<SceneNode> {
        switch (dsl.type) {
            case 'ELLIPSE':
                return figma.createEllipse();
            case 'LINE':
                return figma.createLine();
            default:
                return figma.createRectangle();
        }
    }

    protected async applyTypeSpecificProps(
        node: SceneNode,
        dsl: NodeLayer,
        context: RenderContext
    ): Promise<void> {
        const props = dsl.props;

        // 1. Resize (Handled here as shapes are not always AutoLayout)
        const targetW = PropertyTransformer.deserialize(props.width ?? (node as any).width, PROPS.width);
        const targetH = PropertyTransformer.deserialize(props.height ?? (node as any).height, PROPS.height);

        if (props.width !== undefined || props.height !== undefined) {
             if ('resize' in node) {
                (node as any).resize(Math.max(1, targetW), Math.max(1, targetH));
             }
        }

        // 2. Visuals (Fills/Strokes)
        if ('fills' in node && props.fills) {
            const paints: Paint[] = [];
            for (const fill of props.fills) {
                const paint = await this.createPaintFn(fill);
                if (paint) paints.push(paint);
            }
            (node as any).fills = paints;
        }

        if ('strokes' in node && props.strokes) {
            const paints: Paint[] = [];
            for (const stroke of props.strokes) {
                const paint = await this.createPaintFn(stroke);
                if (paint) paints.push(paint);
            }
            (node as any).strokes = paints;
            if (props.strokeWeight) {
                (node as any).strokeWeight = PropertyTransformer.deserialize(props.strokeWeight, PROPS.strokeWeight);
            }
        }
    }
}
