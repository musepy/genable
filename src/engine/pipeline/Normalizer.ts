/**
 * @file Normalizer.ts
 * @description Pre-render property normalization layer.
 * 
 * [RESPONSIBILITIES]:
 * 1. Correct common LLM "Common Sense" failures (e.g., HUG without Layout).
 * 2. Bridge schema discrepancies (e.g., characters vs content).
 * 3. Log all alterations for transparency (anti-silent correction).
 */

import type { NodeLayer } from '../../schema/layerSchema';
import { flowObserver, FlowPhase } from '../figma-adapter/observers/flowObserver';
import { NODE_TYPES, PROPS, LAYOUT_MODES, SIZING_MODES } from '../../constants/figma-api';
// Static import for config
import RUNTIME_CONFIG from '../../config/runtime-coercion.json';

export class Normalizer {
    /**
     * Main entry: Recursively normalize a NodeLayer tree
     */
    public static normalize(input: unknown): NodeLayer {
        if (!input) return this.createDefaultNode();
        
        // 1. Structure Healing (Array wrapping)
        let processed = this.healStructure(input);
        
        // 2. Recursive Processing
        return this.processNode(processed);
    }

    private static processNode(node: any): any {
        if (!node || typeof node !== 'object') return node;

        const layer = { ...node };
        if (!layer.props) layer.props = {};

        // 1. Normalize Type (Keep basic type normalization or make it strict?)
        // Let's keep basic safety for now but remove deep coercion if possible.
        this.normalizeType(layer);

        // 2. Lift Props: REMOVED for strict mode
        // this.liftProps(layer);

        // 3. Property Transformation (Aliases & Coercion)
        // Kept minimal for basic type safety (e.g. number parsing) but removed fuzzy aliases
        this.coercePropertyValues(layer.props);
        
        // 4. Enums: REMOVED fuzzy matching.
        // We can add strict validation here if we want to delete invalid enums.
        this.validateEnums(layer.props);

        // 5. Recursive for children
        if (Array.isArray(layer.children)) {
            if (layer.children.length === 0) {
                delete (layer as any).children;
            } else {
                layer.children = layer.children.map((child: any) => this.processNode(child));
            }
        }

        // 6. Strict Sanitation: Remove legacy keys that are no longer lifted
        if ('style' in layer) delete (layer as any).style;
        if ('layout' in layer) delete (layer as any).layout;

        return layer;
    }

    private static healStructure(input: any): any {
        if (Array.isArray(input)) {
            this.logFix({ type: 'FRAME' } as any, 'LLM returned array, wrapped in FRAME container');
            return {
                type: NODE_TYPES.FRAME,
                props: { [PROPS.name]: 'Generated Container' },
                children: input
            };
        }
        return input;
    }

    private static normalizeType(layer: any): void {
        if (typeof layer.type !== 'string') {
            layer.type = NODE_TYPES.FRAME;
            return;
        }
        // Basic uppercase normalization is fine
        layer.type = layer.type.toUpperCase();
    }

    // REMOVED: liftProps

    // REMOVED: normalizePropertyAliases

    private static coercePropertyValues(props: any): void {
        const numericFields = [
            PROPS.width, PROPS.height, PROPS.gap, PROPS.strokeWeight, 
            PROPS.cornerRadius, PROPS.fontSize, PROPS.paddingTop, 
            PROPS.paddingRight, PROPS.paddingBottom, PROPS.paddingLeft
        ];

        numericFields.forEach(field => {
            if (props[field] !== undefined) {
                const parsed = parseFloat(props[field] as any);
                props[field] = isNaN(parsed) ? undefined : parsed;
            }
        });

        // Color Arrays - valid schema requirement
        [PROPS.fills, PROPS.strokes].forEach(field => {
            if (Array.isArray(props[field])) {
                props[field] = props[field].map((val: any) => {
                    if (typeof val === 'string') return val;
                    if (typeof val === 'object' && val !== null) return val.color || val.value || val.hex;
                    return val;
                }).filter((f: any) => typeof f === 'string' && f.length > 0);
            }
        });
    }

    private static validateEnums(props: any): void {
         const ENUM_VALIDATORS: Record<string, string[]> = {
            [PROPS.layoutMode]: [LAYOUT_MODES.VERTICAL, LAYOUT_MODES.HORIZONTAL, LAYOUT_MODES.NONE],
            [PROPS.layoutSizingHorizontal]: [SIZING_MODES.FIXED, SIZING_MODES.FILL, SIZING_MODES.HUG],
            [PROPS.layoutSizingVertical]: [SIZING_MODES.FIXED, SIZING_MODES.FILL, SIZING_MODES.HUG]
        };

        const ENUM_ALIASES: Record<string, Record<string, string>> = {
            [PROPS.layoutSizingHorizontal]: { 'AUTO': SIZING_MODES.HUG, 'STRETCH': SIZING_MODES.FILL },
            [PROPS.layoutSizingVertical]: { 'AUTO': SIZING_MODES.HUG, 'STRETCH': SIZING_MODES.FILL }
        };

        for (const [prop, validValues] of Object.entries(ENUM_VALIDATORS)) {
            const rawValue = props[prop];
            if (rawValue) {
                let currentVal = String(rawValue).toUpperCase();
                
                // Handle Alises
                if (ENUM_ALIASES[prop] && ENUM_ALIASES[prop][currentVal]) {
                    currentVal = ENUM_ALIASES[prop][currentVal];
                }

                if (validValues.includes(currentVal)) {
                    props[prop] = currentVal;
                } else if (!validValues.includes(rawValue)) {
                     // Invalid enum value? Delete it (Strict)
                     delete props[prop];
                }
            }
        }
        
        // Name check?
        if (props[PROPS.semantic]) {
            props[PROPS.semantic] = String(props[PROPS.semantic]).toUpperCase().trim().replace(/ /g, '_');
        }
    }

    private static createDefaultNode(): NodeLayer {
        return {
            type: NODE_TYPES.FRAME,
            props: { [PROPS.name]: 'Node' },
            children: []
        };
    }

    private static logFix(node: NodeLayer, message: string): void {
        flowObserver.log(FlowPhase.POST_PROCESS, `[Normalizer] ${message}`, {
            nodeName: node.props?.name,
            nodeType: node.type
        });
    }
}
