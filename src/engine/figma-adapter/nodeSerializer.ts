/**
 * @file nodeSerializer.ts
 * @description Node Serializer - Orchestrates the conversion of Figma SceneNodes to DSL.
 *
 * Architecture: blacklist-based discovery (not whitelist).
 * All properties from PROPERTY_REGISTRY flow through, classified as:
 *   - Known (in PROP_METADATA) → rich handling (enum mapping, default pruning)
 *   - Unknown (not in PROP_METADATA) → raw value with basic default pruning
 */

import type { NodeLayer } from '../../schema/layerSchema';
import { NODE_TYPES } from '../../constants/figma-api';
import { PROPERTY_META, FIGMA_TO_DSL } from '../../constants/figma-property-registry';
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

/** Keys handled separately — id/type go on NodeLayer directly, not in props. */
const IDENTITY_KEYS = new Set(['id', 'type']);

/** Properties that need special serialization (fills/strokes/effects/unit values). */
const SPECIAL_KEYS = new Set(['fills', 'strokes', 'effects', 'lineHeight', 'letterSpacing']);

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

        // 2. Extract Properties — registry-based (blacklist filtering in extractFigmaNodeData)
        const props: Record<string, any> = {};
        const nodeData = extractFigmaNodeData(node);

        for (const [figmaKey, rawValue] of Object.entries(nodeData)) {
            if (IDENTITY_KEYS.has(figmaKey)) continue;

            // Translate Figma API name → DSL name (e.g. itemSpacing → gap)
            const dslKey = FIGMA_TO_DSL[figmaKey] || figmaKey;
            const meta = PROPERTY_META[dslKey];

            if (SPECIAL_KEYS.has(figmaKey)) {
                // Special handling for complex types
                let value: any;
                if (figmaKey === 'fills' || figmaKey === 'strokes') {
                    if (rawValue) {
                        value = readPaints(rawValue); // filter invisible, keep Figma format
                    }
                } else if (figmaKey === 'effects') {
                    if (rawValue) {
                        value = readEffects(rawValue); // filter invisible, keep Figma format
                    }
                } else if (figmaKey === 'lineHeight' || figmaKey === 'letterSpacing') {
                    if (rawValue && typeof rawValue === 'object' && rawValue.unit === 'AUTO') {
                        value = undefined; // AUTO = default, skip
                    } else if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
                        value = rawValue.value;
                    } else {
                        value = meta ? PropertyTransformer.serialize(nodeData, dslKey) : rawValue;
                    }
                }

                if (value !== undefined) {
                    // fills/strokes/effects: skip PropertyTransformer.isEqual — it loses
                    // non-SOLID paints and non-standard effects, causing false prune.
                    if (figmaKey === 'fills' || figmaKey === 'strokes' || figmaKey === 'effects') {
                        if (Array.isArray(value) && value.length > 0) props[dslKey] = value;
                    } else {
                        if (pruneDefaults && meta?.defaultValue !== undefined) {
                            if (PropertyTransformer.isEqual(nodeData, dslKey, meta.defaultValue)) continue;
                        }
                        if (Array.isArray(value) && value.length === 0) continue;
                        props[dslKey] = value;
                    }
                }
            } else if (meta) {
                // Known property — rich handling via PropertyTransformer
                const value = PropertyTransformer.serialize(nodeData, dslKey);
                if (value !== undefined) {
                    if (pruneDefaults && meta.defaultValue !== undefined) {
                        if (PropertyTransformer.isEqual(nodeData, dslKey, meta.defaultValue)) continue;
                    }
                    if (Array.isArray(value) && value.length === 0) continue;
                    props[dslKey] = value;
                }
            } else {
                // Unknown property — raw value with basic default pruning
                if (rawValue === undefined || rawValue === null) continue;
                if (rawValue === 0 || rawValue === false || rawValue === '' || rawValue === 'NONE' || rawValue === 'AUTO') continue;
                if (Array.isArray(rawValue) && rawValue.length === 0) continue;
                if (typeof rawValue === 'object' && !Array.isArray(rawValue)) continue; // skip complex objects
                props[dslKey] = rawValue;
            }
        }

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
     * Minimal serialization: id + type + name, optionally with one level of children.
     * Used by handlers that need lightweight node references (jsx response, edit response, page detail).
     */
    static serializeMinimal(node: SceneNode, includeChildren = false): NodeLayer {
        const layer: NodeLayer = {
            id: node.id,
            type: this.mapFigmaType(node.type),
            props: { name: node.name } as any,
        };
        if (includeChildren && 'children' in node) {
            layer.children = (node as any).children
                .filter((c: SceneNode) => c.visible)
                .map((c: SceneNode) => this.serializeMinimal(c, false));
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
    static mapFigmaType(figmaType: string): any {
        const MAP: Record<string, any> = {
            'FRAME': NODE_TYPES.FRAME,
            'GROUP': NODE_TYPES.GROUP,
            'SECTION': NODE_TYPES.SECTION,
            'COMPONENT': NODE_TYPES.COMPONENT,
            'COMPONENT_SET': NODE_TYPES.COMPONENT_SET,
            'INSTANCE': NODE_TYPES.INSTANCE,
            'TEXT': NODE_TYPES.TEXT,
            'RECTANGLE': NODE_TYPES.RECTANGLE,
            'VECTOR': NODE_TYPES.VECTOR,
            'LINE': NODE_TYPES.LINE,
            'ELLIPSE': NODE_TYPES.ELLIPSE,
            'STAR': NODE_TYPES.STAR,
            'POLYGON': NODE_TYPES.POLYGON,
            'BOOLEAN_OPERATION': NODE_TYPES.BOOLEAN_OPERATION
        };

        return MAP[figmaType] || NODE_TYPES.FRAME;
    }
}
