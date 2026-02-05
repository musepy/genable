/**
 * @file propertyTransformer.ts
 * @description Unified Property Transformer - The "Universal Translator" for Figma <-> DSL.
 * 
 * Follows SSOT (using PROP_METADATA from figma-api.ts).
 * Ensures consistency between extraction (serialization) and rendering (deserialization).
 */

import { PROP_METADATA, PROPS } from '../../constants/figma-api';
import { rgbToHex } from '../../utils/colorUtils';
import { FigmaNodeData } from './figmaNodeData';

export class PropertyTransformer {
    /**
     * SERIALIZE: Figma API -> DSL
     * Extracts a property from a Figma node data and converts it to its DSL representation.
     * 
     * @param nodeData - The source Figma node data (IR)
     * @param dslKey - The target key in our DSL (from PROPS)
     * @returns The DSL-compatible value
     */
    static serialize(nodeData: FigmaNodeData, dslKey: string): any {
        const meta = PROP_METADATA[dslKey];
        if (!meta) return undefined;

        // 1. Direct Field Extraction (if not virtual)
        let figmaValue: any = undefined;
        if (meta.type !== 'virtual') {
            figmaValue = nodeData[meta.figmaKey];
            // console.log(`[Debug] ${dslKey} (figmaKey: ${meta.figmaKey}) =`, figmaValue);
        }

        // [Figma Sandbox Fix] Safety: Handle figma.mixed (a Symbol)
        // Symbols cannot be passed through postMessage (emit), causing "Cannot unwrap symbol"
        const figmaMixed = typeof figma !== 'undefined' ? figma.mixed : undefined;
        if (typeof figmaMixed !== 'undefined' && figmaValue === figmaMixed) {
            // console.log(`[Debug] ${dslKey} is figma.mixed -> returning null`);
            return null;
        }

        // 2. Transformation Logic based on type
        switch (meta.type) {
            case 'scalar':
                if (figmaValue === undefined) return meta.defaultValue;
                return figmaValue;

            case 'color':
                // Figma Paint[] -> string[] (Hex)
                if (Array.isArray(figmaValue)) {
                    return figmaValue
                        .map(paint => {
                            if (paint.type === 'SOLID') {
                                return rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                            }
                            // Legacy/Future: Gradient/Image handling can be added here
                            return null;
                        })
                        .filter(val => val !== null);
                }
                return [];

            case 'enum':
                // Usually maps directly if normalization was done correctly
                return figmaValue;

            case 'virtual':
                // Logic for properties that don't exist directly on the node object
                return this.extractVirtualProperty(nodeData, dslKey);

            case 'array':
                // For complex arrays like effects
                return this.serializeArray(figmaValue, dslKey);

            default:
                return figmaValue;
        }
    }

    /**
     * DESERIALIZE: DSL -> Figma API
     * Converts a DSL value into a format that can be applied to a Figma node.
     * Note: Some properties (like colors) require async factory functions (createPaint).
     * 
     * @param dslValue - The value from LLM/DSL
     * @param dslKey - The key from PROPS
     * @returns The Figma-compatible value (or instruction for the renderer)
     */
    static deserialize(dslValue: any, dslKey: string): any {
        const meta = PROP_METADATA[dslKey];
        if (!meta) return dslValue;

        switch (meta.type) {
            case 'color':
                // Fills/Strokes are handled by the renderer calling createPaintFn
                // We return the raw value (string or array)
                return dslValue;

            case 'enum':
                if (meta.enumMap && typeof dslValue === 'string') {
                    return meta.enumMap[dslValue.toUpperCase()] || dslValue;
                }
                return dslValue;

            case 'scalar':
                if (dslValue === null || dslValue === undefined) return 0;
                if (typeof dslValue === 'string' && !dslValue.startsWith('$')) {
                    const parsed = parseFloat(dslValue);
                    return isNaN(parsed) ? 0 : parsed;
                }
                // V6.1 FIX: Prevent number NaN leak
                if (typeof dslValue === 'number') {
                    return isNaN(dslValue) ? 0 : dslValue;
                }
                return dslValue;

            case 'string':
                return String(dslValue ?? '');

            default:
                return dslValue;
        }
    }

    /**
     * Internal: Handle properties that require specific logic to extract
     */
    private static extractVirtualProperty(nodeData: FigmaNodeData, dslKey: string): any {
        switch (dslKey) {
            case PROPS.fontFamily:
                return nodeData.fontName ? (nodeData.fontName as FontName).family : null;
            case PROPS.fontWeight:
                return nodeData.fontName ? (nodeData.fontName as FontName).style : null;
            case PROPS.semantic:
                // [PURE TRUST] Removed naming-based inference. Trusted to LLM/props only.
                return undefined;
            default:
                return undefined;
        }
    }

    /**
     * Internal: Serialize arrays of objects (e.g. effects)
     */
    private static serializeArray(figmaValue: any, dslKey: string): any {
        if (dslKey === PROPS.effects && Array.isArray(figmaValue)) {
            return figmaValue.map((eff: Effect) => {
                const base = { type: eff.type };
                if (eff.type === 'DROP_SHADOW' || eff.type === 'INNER_SHADOW') {
                    const shadow = eff as DropShadowEffect | InnerShadowEffect;
                    return {
                        ...base,
                        color: rgbToHex(shadow.color.r, shadow.color.g, shadow.color.b), // Simple hex for now
                        offset: shadow.offset,
                        radius: shadow.radius,
                        spread: shadow.spread
                    };
                }
                return base;
            });
        }
        return figmaValue;
    }

    /**
     * DIFF: compare DSL value with existing Figma node state
     * Returns true if they are functionally equal, allowing the renderer to skip the write.
     */
    static isEqual(nodeData: FigmaNodeData, dslKey: string, dslValue: any): boolean {
        // 1. Serialize current state
        const currentState = this.serialize(nodeData, dslKey);

        // 2. Perform comparison based on prop type
        const meta = PROP_METADATA[dslKey];
        if (!meta) return false;

        if (meta.type === 'scalar' || meta.type === 'string' || meta.type === 'enum') {
            return currentState === dslValue;
        }

        if (meta.type === 'color') {
            // Colors are often arrays of hex strings ["#FFFFFF"]
            if (!Array.isArray(currentState) || !Array.isArray(dslValue)) return false;
            if (currentState.length !== dslValue.length) return false;
            return currentState.every((v, i) => String(v).toUpperCase() === String(dslValue[i]).toUpperCase());
        }

        if (meta.type === 'array') {
            // Complex arrays like effects require deep comparison
            return this.deepEqual(currentState, dslValue);
        }

        return false;
    }

    /**
     * Internal: Robust deep equality check for complex nested objects and arrays.
     * Handles key ordering differences in objects.
     */
    private static deepEqual(a: any, b: any): boolean {
        if (a === b) return true;

        if (a && b && typeof a === 'object' && typeof b === 'object') {
            if (Array.isArray(a)) {
                if (!Array.isArray(b) || a.length !== b.length) return false;
                for (let i = 0; i < a.length; i++) {
                    if (!this.deepEqual(a[i], b[i])) return false;
                }
                return true;
            }

            if (Array.isArray(b)) return false;

            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;

            for (const key of keysA) {
                if (!keysB.includes(key)) return false;
                if (!this.deepEqual(a[key], b[key])) return false;
            }
            return true;
        }

        return false;
    }
}
