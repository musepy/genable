/**
 * @file propertyTransformer.ts
 * @description Unified Property Transformer - The "Universal Translator" for Figma <-> DSL.
 * 
 * Follows SSOT (using PROP_METADATA from figma-api.ts).
 * Ensures consistency between extraction (serialization) and rendering (deserialization).
 */

import { PROP_METADATA, PROPS } from '../../constants/figma-api';
import { rgbToHex } from '../../utils/colorUtils';

export class PropertyTransformer {
    /**
     * SERIALIZE: Figma API -> DSL
     * Extracts a property from a Figma node and converts it to its DSL representation.
     * 
     * @param node - The source Figma node
     * @param dslKey - The target key in our DSL (from PROPS)
     * @returns The DSL-compatible value
     */
    static serialize(node: SceneNode, dslKey: string): any {
        const meta = PROP_METADATA[dslKey];
        if (!meta) return undefined;

        // 1. Direct Field Extraction (if not virtual)
        let figmaValue: any = undefined;
        if (meta.type !== 'virtual') {
            figmaValue = (node as any)[meta.figmaKey];
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
                return this.extractVirtualProperty(node, dslKey);

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
                if (typeof dslValue === 'string' && !dslValue.startsWith('$')) {
                    const parsed = parseFloat(dslValue);
                    return isNaN(parsed) ? 0 : parsed;
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
    private static extractVirtualProperty(node: SceneNode, dslKey: string): any {
        switch (dslKey) {
            case PROPS.fontFamily:
                return 'fontName' in node ? (node.fontName as FontName).family : undefined;
            case PROPS.fontWeight:
                return 'fontName' in node ? (node.fontName as FontName).style : undefined;
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
}
