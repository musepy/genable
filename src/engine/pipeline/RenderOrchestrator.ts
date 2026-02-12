/**
 * @file RenderOrchestrator.ts
 * @description Central pipeline for rendering DSL to Figma SceneNodes.
 * 
 * [RESPONSIBILITIES]:
 * 1. Orchestrate the full rendering lifecycle (Warmup -> Normalize -> Skeleton -> Calibrate).
 * 2. Unified entrance for both Stream and Final Create requests.
 * 3. Manage the "Two-Pass" layout stability logic.
 */

import { NodeLayer, RenderContext, renderNodeDSL, initializeRenderers } from '../figma-adapter/renderers';
import { fontBus } from '../figma-adapter/resources/FontBus';
import { Normalizer } from './Normalizer';
import { DesignSystemConfig } from '../../types/designSystem';
import { figmaVariableCache } from '../figma-adapter/caches/figmaVariableCache';
import { flowObserver, FlowPhase } from '../figma-adapter/observers/flowObserver';

// ==========================================
// REGISTRY FOR RECONCILIATION
// ==========================================
const nodeRegistry = new Map<string, SceneNode>();

export function clearRegistry(): void {
    nodeRegistry.clear();
}

export function registerNode(id: string, node: SceneNode): void {
    nodeRegistry.set(id, node);
}

/**
 * Check if a Figma node is currently managed by the reconciliation system
 */
export function isNodeManaged(node: SceneNode): boolean {
    let managed = false;
    nodeRegistry.forEach((managedNode) => {
        if (managedNode === node) managed = true;
    });
    return managed;
}

export async function findNodeByIdAsync(id: string): Promise<SceneNode | null> {
    // 1. Check persistent registry (high performance, same-session)
    const node = nodeRegistry.get(id);
    if (node) {
        try {
            if (node.removed) throw new Error('removed');
            const _ = node.type; 
            return node;
        } catch (e) {
            nodeRegistry.delete(id);
        }
    }
    
    // 2. Fallback to Figma Global ID (for atomic tool calls or cross-session persistence)
    try {
        const figmaNode = await figma.getNodeByIdAsync(id);
        if (figmaNode && figmaNode.type !== 'DOCUMENT' && figmaNode.type !== 'PAGE') {
            return figmaNode as SceneNode;
        }
    } catch (e) {
        // Node not found or invalid type
    }
    
    return null;
}

export interface RenderOptions {
    layerData: NodeLayer;
    designSystemId: string;
    designSystemConfig: DesignSystemConfig;
    renderContext?: {
        width: number;
        height: number;
        isMobile: boolean;
    };
    meta?: {
        traceId?: string;
        isStream?: boolean;
        position?: { x: number; y: number };
        parent?: (SceneNode & ChildrenMixin) | PageNode;
        insertIndex?: number;
        viewportCenter?: { x: number; y: number };
        parentBounds?: { width: number; height: number };
        positionStrategy?: 'VIEWPORT' | 'PARENT_CENTER' | 'MANUAL';
    };
}

export class RenderOrchestrator {
    private static isInitialized = false;

    /**
     * Unified Render Pipeline
     */
    public async process(options: RenderOptions): Promise<SceneNode | null> {
        const { layerData, designSystemId, designSystemConfig, renderContext, meta } = options;

        // [V7] SYNC TRACE ID (Cross-context sync: UI -> Main)
        if (meta?.traceId) {
            flowObserver.startTrace(meta.traceId);
        }

        if (meta?.traceId && !meta?.isStream) {
            clearRegistry();
        }

        // 1. Initial Resource Warmup (Loading Barrier)
        await this.ensureReady(designSystemConfig);

        // 2. Normalization (Transparency Layer)
        const normalizedDSL = Normalizer.normalize(layerData);

        // [V7] PRE-FLIGHT CHECK: Is this node already part of an active stream?
        const isAlreadyManaged = layerData.id ? (!!await findNodeByIdAsync(layerData.id)) : false;

        // 3. Render directly or reconcile
        const context: RenderContext = {
            parent: meta?.parent ?? figma.currentPage,
            depth: 0,
            designSystem: designSystemConfig,
            viewport: renderContext
        };

        try {
            const rootNode = await renderNodeDSL(normalizedDSL, context as any);
            if (!rootNode) return null;

            const explicitRootX = (normalizedDSL as any)?.props?.x;
            const explicitRootY = (normalizedDSL as any)?.props?.y;
            const hasExplicitRootXY =
                typeof explicitRootX === 'number' ||
                (typeof explicitRootX === 'string' && explicitRootX.trim() !== '') ||
                typeof explicitRootY === 'number' ||
                (typeof explicitRootY === 'string' && explicitRootY.trim() !== '');

            // [V7] PURE POSITIONING
            // Decision logic moved out of orchestrator's gut
            if (hasExplicitRootXY && 'x' in rootNode && 'y' in rootNode) {
                const parsedX = typeof explicitRootX === 'number' ? explicitRootX : parseFloat(String(explicitRootX ?? ''));
                const parsedY = typeof explicitRootY === 'number' ? explicitRootY : parseFloat(String(explicitRootY ?? ''));
                if (!isNaN(parsedX)) rootNode.x = parsedX;
                if (!isNaN(parsedY)) rootNode.y = parsedY;
            } else if (meta?.position && 'x' in rootNode && 'y' in rootNode) {
                rootNode.x = meta.position.x;
                rootNode.y = meta.position.y;
            } else if (context.depth === 0 && 'width' in rootNode && 'height' in rootNode) {
                const { LayoutMath } = require('../utils/LayoutMath');
                const strategy = meta?.positionStrategy || 'VIEWPORT';
                
                // [PRINCIPLED FIX]: Registry-based stability
                // 1. If we already managed this node in a previous chunk of this stream, STAY PUT.
                // 2. Otherwise (First Chunk or Non-Stream), we MUST resolve the position.
                if (meta?.isStream && isAlreadyManaged && strategy === 'VIEWPORT') {
                    // Logic: The node has found its home in the first chunk, don't let viewport drift move it.
                } else {
                    const pos = LayoutMath.resolveRootPosition(strategy, {
                        viewportCenter: meta?.viewportCenter,
                        parentBounds: meta?.parentBounds,
                        nodeDimensions: { width: rootNode.width, height: rootNode.height }
                    });

                    rootNode.x = pos.x;
                    rootNode.y = pos.y;
                }
            }

            return rootNode;
        } catch (error) {
            console.error('[RenderOrchestrator] Rendering Pipeline Failed:', error);
            throw error;
        }
    }

    /**
     * Internal: Ensure variables, fonts, and renderers are ready.
     */
    private async ensureReady(config: DesignSystemConfig): Promise<void> {
        // [SINGLETON-ISH INIT] Only initialize if needed or if config changed drastically
        if (!RenderOrchestrator.isInitialized) {
            // Initialize Factory with Paint Creator
            // (We'll still need the createPaint logic from main.ts or extract it too)
            // For now, assume initializeRenderers is called externally or we handle it here
            RenderOrchestrator.isInitialized = true;
        }

        // Parallel Warmup of high-stakes resources
        await Promise.all([
            figmaVariableCache.warmup(),
            fontBus.warmup()
        ]);
    }
}

export const renderOrchestrator = new RenderOrchestrator();
