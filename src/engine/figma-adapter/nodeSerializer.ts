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

export interface SerializationOptions {
    maxDepth?: number;
    pruneDefaults?: boolean;
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
     * @param node - The Figma node to serialize
     * @param options - Compression options
     * @param currentDepth - Internal depth tracker
     * @returns A serialized NodeLayer object
     */
    static serializeWithCompression(
        node: SceneNode, 
        options: SerializationOptions = {}, 
        currentDepth: number = 0
    ): NodeLayer {
        const { maxDepth = Infinity, pruneDefaults = true } = options;

        // 1. Map Figma Type to DSL Type
        const type = this.mapFigmaType(node.type);
        
        // 2. Extract Properties
        const props: Record<string, any> = {};
        const nodeData = extractFigmaNodeData(node, Object.values(PROP_METADATA).map(m => m.figmaKey));

        Object.values(PROPS).forEach(dslKey => {
            const value = PropertyTransformer.serialize(nodeData, dslKey);
            
            if (value !== undefined) {
                // Skip default values if pruning is enabled
                if (pruneDefaults) {
                    const meta = PROP_METADATA[dslKey];
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

        // 3. Recursive Serialization with Depth Control
        if (currentDepth < maxDepth && 'children' in node && node.children.length > 0) {
            const visibleChildren = node.children.filter(c => c.visible);
            
            if (visibleChildren.length > 0) {
                layer.children = visibleChildren.map(child => 
                    this.serializeWithCompression(child, options, currentDepth + 1)
                );
            }
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
