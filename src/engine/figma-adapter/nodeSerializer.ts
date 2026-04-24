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
import { getFacetKeys } from '../../constants/figma-property-registry-helpers';
import { PropertyTransformer } from './propertyTransformer';
import { extractFigmaNodeData } from './figmaNodeData';
import { readPaints, readEffects } from '../figma/figma-reader';

export interface SerializationOptions {
    maxDepth?: number;
    pruneDefaults?: boolean;
    /** Max children to fully serialize per level (excess become skeletons). Default: unlimited. */
    maxChildrenPerLevel?: number;
    /** Max total nodes to serialize across the whole tree. Default: unlimited. */
    maxTotalNodes?: number;
    /**
     * Optional facet filter for property extraction.
     *
     * When undefined → legacy path (visual-facet filtering via extractFigmaNodeData).
     * When provided → union of the listed facets decides which registry keys to emit.
     *
     * Special facet names: 'all' (no filter), 'variables' (boundVariables + explicitVariableModes),
     * plus any role-backed name (layout/fill/stroke/effect/appearance/typography).
     *
     * Facets are additionally used to pull role:'computed' keys that the visual path
     * skips — specifically boundVariables and explicitVariableModes, which are the
     * primary reason this option exists (see inspect tool's `facets:['variables']`).
     */
    facets?: Set<string>;
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
     * - facets: optional facet filter — see SerializationOptions.facets
     */
    static serializeWithCompression(
        node: SceneNode,
        options: SerializationOptions = {},
        currentDepth: number = 0,
        state?: SerializationState
    ): NodeLayer {
        const { maxDepth = Infinity, pruneDefaults = true, maxChildrenPerLevel = Infinity, maxTotalNodes = Infinity, facets } = options;

        // Initialize shared state on first call
        if (!state) {
            state = { nodeCount: 0, maxTotalNodes, truncated: false };
        }

        // Count this node
        state.nodeCount++;

        // 1. Map Figma Type to DSL Type
        const type = this.mapFigmaType(node.type);

        // 2. Build key set for extraction.
        //    - No facets → legacy visual path via extractFigmaNodeData (byte-identical default).
        //    - Facets present → union of requested facet keys. 'variables'/'all' additionally pull
        //      boundVariables + explicitVariableModes (computed role, bypassed by the visual path).
        //
        // When facets are specified we also cap the iteration below to the allowed set so that
        // the unconditional fills/strokes/effects overrides inside extractFigmaNodeData don't
        // leak into e.g. a `facets:['variables']` response.
        const props: Record<string, any> = {};
        const facetKeyList = facets ? this.buildFacetExtractionKeys(node.type, facets) : undefined;
        const allowedKeys = facetKeyList ? new Set(facetKeyList) : undefined;
        const nodeData = extractFigmaNodeData(node, facetKeyList);

        for (const [figmaKey, rawValue] of Object.entries(nodeData)) {
            if (allowedKeys && !IDENTITY_KEYS.has(figmaKey) && !allowedKeys.has(figmaKey)) continue;
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
                // Variables facet: preserve boundVariables + explicitVariableModes objects.
                // (Legacy path hits `continue` below because they're role:'computed' and not in PROP_META.)
                if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
                    if (facets && (figmaKey === 'boundVariables' || figmaKey === 'explicitVariableModes')) {
                        if (Object.keys(rawValue).length > 0) props[dslKey] = rawValue;
                    }
                    continue;
                }
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
     * Build the explicit key list for facet-based extraction.
     *
     * Called only when callers pass `facets`. Unions the requested facets via
     * `getFacetKeys`, then always adds boundVariables + explicitVariableModes
     * when `variables` or `all` is requested — those have role:'computed' and
     * would be filtered out by any role-based selection, but are the whole
     * reason the variables facet exists.
     *
     * Paints (fills/strokes) and effects are always added so `SPECIAL_KEYS`
     * handling still runs when the user asks for paint/fill/stroke/effect/all.
     */
    private static buildFacetExtractionKeys(nodeType: string, facets: Set<string>): string[] {
        const keys = new Set<string>();

        // Always include identity so downstream handlers have node.name.
        keys.add('name');

        const wantAll = facets.has('all');
        const wantVariables = wantAll || facets.has('variables');

        // Registry facet names (role-backed).
        const ROLE_FACETS: Record<string, string> = {
            layout: 'layout',
            paint: 'fill',        // alias: 'paint' → fill role
            fill: 'fill',
            stroke: 'stroke',
            text: 'typography',
            typography: 'typography',
            effects: 'effect',
            appearance: 'appearance',
        };

        if (wantAll) {
            // Pull every key the registry knows about.
            for (const k of getFacetKeys(nodeType, 'all')) keys.add(k);
        } else {
            for (const f of facets) {
                const role = ROLE_FACETS[f];
                if (role) {
                    for (const k of getFacetKeys(nodeType, role)) keys.add(k);
                } else if (f === 'variables') {
                    for (const k of getFacetKeys(nodeType, 'variables')) keys.add(k);
                }
            }
        }

        // Variables facet: always surface boundVariables + explicitVariableModes,
        // even though they're role:'computed' (not captured by ROLE_FACETS above
        // when only a non-variables facet is requested).
        if (wantVariables) {
            keys.add('boundVariables');
            keys.add('explicitVariableModes');
        }

        // Ensure paint/effect/stroke facets also pull the shared fills/strokes/effects fields
        // (already included via role match above for fill/stroke/effect; 'paint' alias handled via ROLE_FACETS).
        return Array.from(keys);
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
