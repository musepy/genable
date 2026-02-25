/**
 * @file index.ts
 * @description Renderer Factory - Strategy Pattern Entry Point
 * 
 * [INPUT]:  NodeLayer from postProcessor
 * [OUTPUT]: Figma SceneNode
 * [POS]:    Renderers - main entry point for rendering DSL to Figma
 * 
 * ARCHITECTURE NOTE:
 * FrameRenderer needs to recursively render children, which requires calling
 * back into renderNodeDSL. We break this circular dependency using the
 * setChildRenderer() callback pattern during lazy initialization.
 */

import { NodeLayer, RenderContext, BaseRenderer } from './baseRenderer';
import { FrameRenderer } from './frameRenderer';
import { TextRenderer } from './textRenderer';
import { VectorRenderer } from './vectorRenderer';
import { InstanceRenderer } from './instanceRenderer';
import { IconRenderer } from './iconRenderer';
import { findBestComponentMatch } from '../../../knowledge/semanticMap';
import { LibraryResource } from '../../../types';
import { isEnabled } from '../../../constants/featureFlags';
import { flowObserver, FlowPhase } from '../observers/flowObserver';
import { ShapeRenderer } from './shapeRenderer';

// ==========================================
// MODULE STATE (for dependency injection)
// ==========================================

let createPaintFn: ((color: string | Record<string, any>) => Promise<Paint | null>) | null = null;
let availableComponents: LibraryResource[] = [];
let isInitialized = false;

function ensureInitialized(): void {
    if (!isInitialized || !createPaintFn) {
        throw new Error(
            '[RendererFactory] Not initialized! Call initializeRenderers() before rendering.'
        );
    }
}

// ==========================================
// RENDERER REGISTRY (Dynamic Map)
// ==========================================

const registry = new Map<string, BaseRenderer>();

/**
 * Register a new renderer for a specific node type
 */
export function registerRenderer(type: string, renderer: BaseRenderer): void {
    registry.set(type, renderer);
}

/**
 * Select the appropriate renderer based on node type
 */
function getRendererForType(type: string): BaseRenderer {
    ensureInitialized();
    
    // Default fallback to VectorRenderer for unknown or basic shape types
    const renderer = registry.get(type) || registry.get('VECTOR');
    
    if (!renderer) {
        throw new Error(`[RendererFactory] No renderer registered for type: ${type}`);
    }
    
    return renderer;
}

/**
 * Initialize the renderer factory with default set
 */
export function initializeRenderers(
    paintCreator: (color: string | Record<string, any>) => Promise<Paint | null>,
    components: LibraryResource[] = []
): void {
    createPaintFn = paintCreator;
    availableComponents = components;
    isInitialized = true;

    // Populate Registry with Default Core Renderers
    const frame = new FrameRenderer(createPaintFn!);
    // Break circular dependency for recursive Frame rendering
    frame.setChildRenderer(renderNodeDSL);

    registerRenderer('FRAME', frame);
    registerRenderer('TEXT', new TextRenderer(createPaintFn!));
    registerRenderer('VECTOR', new VectorRenderer(createPaintFn!));
    registerRenderer('RECTANGLE', registry.get('VECTOR')!); // Alias
    registerRenderer('INSTANCE', new InstanceRenderer(createPaintFn!));
    registerRenderer('ICON', new IconRenderer(createPaintFn!));

    const shape = new ShapeRenderer(createPaintFn!);
    registerRenderer('ELLIPSE', shape);
    registerRenderer('LINE', shape);
}

/**
 * Main entry point: Render a NodeLayer to Figma SceneNode
 * 
 * @param dsl - NodeLayer from postProcessor
 * @param context - Render context (parent, depth, layout mode)
 * @returns Created SceneNode or null if failed
 * 
 * @throws Error if initializeRenderers() was not called first
 */
export async function renderNodeDSL(
    dsl: NodeLayer,
    context: RenderContext
): Promise<SceneNode | null> {
    let finalDSL = dsl;

    // SEMANTIC SWAPPING: If a FRAME has a semantic token, try to swap with an INSTANCE
    if (isEnabled('USE_SEMANTIC_SWAP') && dsl.type === 'FRAME' && dsl.props.semantic && dsl.props.semantic !== 'DEFAULT') {
        const match = findBestComponentMatch(dsl.props.semantic, availableComponents);
        if (match) {
            // [V6 PHASE P2] Log Semantic Swap
            flowObserver.log(FlowPhase.SWAP, `Semantic match found for ${dsl.props.semantic}`, { 
                target: match.name, 
                key: match.key 
            });
            
            finalDSL = {
                ...dsl,
                type: 'INSTANCE',
                props: {
                    ...dsl.props,
                    mainComponentKey: match.key
                }
            };
        }
    }

    const renderer = getRendererForType(finalDSL.type);
    
    // [V6 PHASE P2] Log Render Start
    flowObserver.log(FlowPhase.RENDER, `Rendering node: ${finalDSL.props?.name || 'unnamed'} (${finalDSL.type})`, {
        depth: context.depth
    });

    return renderer.render(finalDSL as any, context);
}

// ==========================================
// RE-EXPORTS
// ==========================================

export type { NodeLayer, RenderContext, NodeLayerProps } from './baseRenderer';
export { FrameRenderer } from './frameRenderer';
export { TextRenderer } from './textRenderer';
export { VectorRenderer } from './vectorRenderer';
export { InstanceRenderer } from './instanceRenderer';
export { IconRenderer } from './iconRenderer';

