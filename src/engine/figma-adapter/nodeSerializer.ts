/**
 * @file nodeSerializer.ts
 * @description Node Serializer - Orchestrates the conversion of Figma SceneNodes to DSL.
 * 
 * Uses PropertyTransformer for attribute alignment. 
 * This ensures the LLM receives data in the EXACT same format it is expected to output.
 */

import type { NodeLayer } from '../../schema/layerSchema';
import { PROPS, NODE_TYPES, PROP_METADATA } from '../../constants/figma-api';
import { PropertyTransformer } from './propertyTransformer';
import { extractFigmaNodeData } from './figmaNodeData';
import { readPaints, readEffects, readUnitValue, readFontName } from '../figma/figma-reader';

export interface SerializationOptions {
    maxDepth?: number;
    pruneDefaults?: boolean;
    /** Max children to fully serialize per level (excess become skeletons). Default: unlimited. */
    maxChildrenPerLevel?: number;
    /** Max total nodes to serialize across the whole tree. Default: unlimited. */
    maxTotalNodes?: number;
}

/** Mutable counter shared across recursive calls to enforce maxTotalNodes. */
interface SerializationState {
    nodeCount: number;
    maxTotalNodes: number;
    truncated: boolean;
}

export class NodeSerializer {
    /**
     * Convert a Figma node and its visible children into a NodeLayer tree.
     * Default version (no compression) for full pipeline use.
     */
    static serialize(node: SceneNode): NodeLayer {
        return this.serializeWithCompression(node, { pruneDefaults: false });
    }

    /**
     * Compressed version of serialization for Agentic Context.
     * 
     * Supports output budget controls:
     * - maxDepth: vertical depth limit (default: Infinity)
     * - maxChildrenPerLevel: horizontal children cap per node (default: Infinity)
     * - maxTotalNodes: global node count limit (default: Infinity)
     * 
     * @param node - The Figma node to serialize
     * @param options - Compression options
     * @param currentDepth - Internal depth tracker
     * @param state - Internal mutable state for node counting (do not pass externally)
     * @returns A serialized NodeLayer object
     */
    static serializeWithCompression(
        node: SceneNode, 
        options: SerializationOptions = {}, 
        currentDepth: number = 0,
        state?: SerializationState
    ): NodeLayer {
        const { maxDepth = Infinity, pruneDefaults = true, maxChildrenPerLevel = Infinity, maxTotalNodes = Infinity } = options;

        // Initialize shared state on first call
        if (!state) {
            state = { nodeCount: 0, maxTotalNodes, truncated: false };
        }

        // Count this node
        state.nodeCount++;

        // 1. Map Figma Type to DSL Type
        const type = this.mapFigmaType(node.type);
        
        // 2. Extract Properties
        const props: Record<string, any> = {};
        const nodeData = extractFigmaNodeData(node, Object.values(PROP_METADATA).map(m => m.figmaKey));

        Object.values(PROPS).forEach(dslKey => {
            // Use specs for complex types, PropertyTransformer for the rest
            let value: any;
            const meta = PROP_METADATA[dslKey];
            if (dslKey === 'fills' || dslKey === 'strokes') {
                const figmaVal = nodeData[meta?.figmaKey ?? dslKey];
                if (figmaVal) {
                    const irPaints = readPaints(figmaVal);
                    // Store raw Figma Paint[] for xmlSerializer (it calls paintSpec.fromFigma internally)
                    value = figmaVal;
                } else {
                    value = undefined;
                }
            } else if (dslKey === 'effects') {
                value = nodeData[meta?.figmaKey ?? dslKey];
            } else if (dslKey === 'lineHeight' || dslKey === 'letterSpacing') {
                const figmaVal = nodeData[meta?.figmaKey ?? dslKey];
                if (figmaVal && typeof figmaVal === 'object' && figmaVal.unit === 'AUTO') {
                    value = undefined; // AUTO = default, skip
                } else if (figmaVal && typeof figmaVal === 'object' && 'value' in figmaVal) {
                    value = figmaVal.value;
                } else {
                    value = PropertyTransformer.serialize(nodeData, dslKey);
                }
            } else {
                value = PropertyTransformer.serialize(nodeData, dslKey);
            }

            if (value !== undefined) {
                // Skip default values if pruning is enabled
                if (pruneDefaults) {
                    if (meta && meta.defaultValue !== undefined) {
                        const isDefault = PropertyTransformer.isEqual(nodeData, dslKey, meta.defaultValue);
                        if (isDefault) return;
                    }
                }

                // Skip empty arrays
                if (Array.isArray(value) && value.length === 0) return;

                props[dslKey] = value;
            }
        });

        const layer: NodeLayer = {
            id: node.id,
            type,
            props: props as any
        };

        // 3. Recursive Serialization with Depth + Budget Control
        if (currentDepth < maxDepth && 'children' in node && node.children.length > 0) {
            const visibleChildren = node.children.filter(c => c.visible);
            
            if (visibleChildren.length > 0) {
                // Check global node budget before recursing
                if (state.nodeCount >= state.maxTotalNodes) {
                    state.truncated = true;
                    (layer as any)._truncatedChildren = visibleChildren.length;
                } else {
                    // Split into fully-serialized vs skeleton-only children
                    const fullChildren = visibleChildren.slice(0, maxChildrenPerLevel);
                    const skeletonChildren = visibleChildren.slice(maxChildrenPerLevel);

                    layer.children = fullChildren.map(child => 
                        // Stop recursing if global budget exhausted
                        state!.nodeCount >= state!.maxTotalNodes
                            ? this.createSkeleton(child)
                            : this.serializeWithCompression(child, options, currentDepth + 1, state)
                    );

                    // Append skeletons for excess children
                    if (skeletonChildren.length > 0) {
                        const skeletons = skeletonChildren.map(child => this.createSkeleton(child));
                        layer.children.push(...skeletons);
                        (layer as any)._moreChildren = skeletonChildren.length;
                    }
                }
            }
        }

        // Attach truncation marker to root node
        if (currentDepth === 0 && state.truncated) {
            (layer as any)._truncated = true;
            (layer as any)._totalNodesSerialized = state.nodeCount;
        }

        return layer;
    }

    /**
     * Create a minimal skeleton for a node (id + type + name only).
     * Used for children beyond the per-level cap or when total budget is exhausted.
     */
    private static createSkeleton(node: SceneNode): NodeLayer {
        const layer: NodeLayer = {
            id: node.id,
            type: this.mapFigmaType(node.type),
            props: { name: node.name } as any
        };
        if ('children' in node && node.children.length > 0) {
            (layer as any)._childCount = node.children.length;
        }
        return layer;
    }

    /**
     * Map Figma API types to our Internal DSL types
     */
    private static mapFigmaType(figmaType: string): any {
        const MAP: Record<string, any> = {
            'FRAME': NODE_TYPES.FRAME,
            'GROUP': NODE_TYPES.FRAME, 
            'SECTION': NODE_TYPES.FRAME,
            'COMPONENT': NODE_TYPES.FRAME,
            'COMPONENT_SET': NODE_TYPES.FRAME,
            'INSTANCE': NODE_TYPES.FRAME,
            'TEXT': NODE_TYPES.TEXT,
            'RECTANGLE': NODE_TYPES.RECTANGLE,
            'VECTOR': NODE_TYPES.VECTOR,
            'LINE': NODE_TYPES.VECTOR,
            'ELLIPSE': NODE_TYPES.VECTOR,
            'STAR': NODE_TYPES.VECTOR,
            'POLYGON': NODE_TYPES.VECTOR,
            'BOOLEAN_OPERATION': NODE_TYPES.VECTOR
        };

        return MAP[figmaType] || NODE_TYPES.FRAME;
    }
}
