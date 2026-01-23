/**
 * @file nodeSerializer.ts
 * @description Node Serializer - Orchestrates the conversion of Figma SceneNodes to DSL.
 * 
 * Uses PropertyTransformer for attribute alignment. 
 * This ensures the LLM receives data in the EXACT same format it is expected to output.
 */

import { NodeLayer } from '../../schema/layerSchema';
import { PROPS, NODE_TYPES } from '../../constants/figma-api';
import { PropertyTransformer } from './propertyTransformer';

export class NodeSerializer {
    /**
     * Convert a Figma node and its visible children into a NodeLayer tree.
     * 
     * @param node - The Figma node to serialize
     * @returns A serialized NodeLayer object
     */
    static serialize(node: SceneNode): NodeLayer {
        // 1. Map Figma Type to DSL Type
        const type = this.mapFigmaType(node.type);
        
        // 2. Extract Properties using Unified Transformer
        const props: Record<string, any> = {};
        
        // We iterate over PROPS (our SSOT allowlist) to ensure we only extract what we support
        Object.values(PROPS).forEach(dslKey => {
            const value = PropertyTransformer.serialize(node, dslKey);
            if (value !== undefined && value !== null) {
                // Skip empty arrays for cleaner output
                if (Array.isArray(value) && value.length === 0) return;
                
                props[dslKey] = value;
            }
        });

        const layer: NodeLayer = {
            type,
            props: props as any
        };

        // 3. Recursive Serialization for Children
        if ('children' in node && node.children.length > 0) {
            // Only serialize visible children to keep prompt context clean
            const visibleChildren = node.children.filter(c => c.visible);
            
            if (visibleChildren.length > 0) {
                layer.children = visibleChildren.map(child => this.serialize(child));
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
            'GROUP': NODE_TYPES.FRAME, // Treat Groups as Frames for layout purposes
            'SECTION': NODE_TYPES.FRAME,
            'COMPONENT': NODE_TYPES.FRAME,
            'COMPONENT_SET': NODE_TYPES.FRAME,
            'INSTANCE': NODE_TYPES.FRAME,
            'TEXT': NODE_TYPES.TEXT,
            'RECTANGLE': NODE_TYPES.RECTANGLE,
            'VECTOR': NODE_TYPES.VECTOR,
            'LINE': NODE_TYPES.VECTOR, // Simplify geometric primitives to Vector or Rect
            'ELLIPSE': NODE_TYPES.VECTOR,
            'STAR': NODE_TYPES.VECTOR,
            'POLYGON': NODE_TYPES.VECTOR,
            'BOOLEAN_OPERATION': NODE_TYPES.VECTOR
        };

        return MAP[figmaType] || NODE_TYPES.FRAME;
    }
}
