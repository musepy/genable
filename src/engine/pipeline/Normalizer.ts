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

        // 3. Property Aliases (from runtime-coercion.json)
        this.resolveAliases(layer.props);

        // 4. Property Transformation (type coercion)
        this.coercePropertyValues(layer.props);
        
        // 5. Enums: REMOVED fuzzy matching.
        // We can add strict validation here if we want to delete invalid enums.
        this.validateEnums(layer.props);

        // 6. Recursive for children
        if (Array.isArray(layer.children)) {
            if (layer.children.length === 0) {
                delete (layer as any).children;
            } else {
                layer.children = layer.children.map((child: any) => this.processNode(child));
            }
        }

        // 7. Strict Sanitation: Remove legacy keys that are no longer lifted
        // [V6.2 MOD]: Removed aggressive delete. We now prefer lifting in toolCallHandler.
        // If they still exist here, we keep them as a fallback for the renderer.
        // if ('style' in layer) delete (layer as any).style;
        // if ('layout' in layer) delete (layer as any).layout;

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

    /**
     * Resolve common property aliases from runtime-coercion.json.
     * Moves values from alias keys to canonical keys (e.g., "spacing" → "gap").
     * Only applies when the canonical key is NOT already set.
     */
    private static resolveAliases(props: any): void {
        const aliases = RUNTIME_CONFIG.propertyAliases as Record<string, string>;
        for (const [alias, canonical] of Object.entries(aliases)) {
            if (props[alias] !== undefined && props[canonical] === undefined) {
                props[canonical] = props[alias];
                delete props[alias];
            } else if (props[alias] !== undefined) {
                // Canonical already set, just clean up the alias
                delete props[alias];
            }
        }
    }

    private static coercePropertyValues(props: any): void {
        const numericFields = [
            PROPS.width, PROPS.height, PROPS.gap, PROPS.strokeWeight,
            PROPS.cornerRadius, PROPS.fontSize, PROPS.paddingTop,
            PROPS.paddingRight, PROPS.paddingBottom, PROPS.paddingLeft,
            PROPS.x, PROPS.y, PROPS.layoutGrow
        ];

        // Support optional position object fallback: { position: { x, y } }
        if (props.position && typeof props.position === 'object') {
            if (props[PROPS.x] === undefined && (props.position as any).x !== undefined) {
                props[PROPS.x] = (props.position as any).x;
            }
            if (props[PROPS.y] === undefined && (props.position as any).y !== undefined) {
                props[PROPS.y] = (props.position as any).y;
            }
            delete props.position;
        }

        // Coerce unified padding (number or string → number)
        if (props[PROPS.padding] !== undefined && typeof props[PROPS.padding] !== 'object') {
            const parsed = parseFloat(props[PROPS.padding] as any);
            props[PROPS.padding] = isNaN(parsed) ? undefined : parsed;
        }

        numericFields.forEach(field => {
            if (props[field] !== undefined) {
                const parsed = parseFloat(props[field] as any);
                props[field] = isNaN(parsed) ? undefined : parsed;
            }
        });

        // Color Arrays - valid schema requirement
        // Supports both hex strings and gradient objects ({type: "GRADIENT_LINEAR", stops: [...]})
        [PROPS.fills, PROPS.strokes].forEach(field => {
            if (Array.isArray(props[field])) {
                props[field] = props[field].map((val: any) => {
                    if (typeof val === 'string') return val;
                    // Preserve gradient objects (have type starting with GRADIENT_)
                    if (typeof val === 'object' && val !== null && typeof val.type === 'string' && val.type.startsWith('GRADIENT_')) return val;
                    // Legacy: extract color string from wrapper objects
                    if (typeof val === 'object' && val !== null) return val.color || val.value || val.hex;
                    return val;
                }).filter((f: any) => (typeof f === 'string' && f.length > 0) || (typeof f === 'object' && f !== null && typeof f.type === 'string'));
            }
        });

        // Constraints aliases -> canonical Figma constraint values.
        if (props[PROPS.constraints] && typeof props[PROPS.constraints] === 'object') {
            const constraints = { ...(props[PROPS.constraints] as any) };
            const normalizeHorizontal = (value: any): any => {
                const v = String(value || '').toUpperCase();
                const map: Record<string, string> = {
                    LEFT: 'MIN',
                    RIGHT: 'MAX',
                    LEFT_RIGHT: 'STRETCH'
                };
                return map[v] || v || undefined;
            };
            const normalizeVertical = (value: any): any => {
                const v = String(value || '').toUpperCase();
                const map: Record<string, string> = {
                    TOP: 'MIN',
                    BOTTOM: 'MAX',
                    TOP_BOTTOM: 'STRETCH'
                };
                return map[v] || v || undefined;
            };

            if (constraints.horizontal !== undefined) {
                constraints.horizontal = normalizeHorizontal(constraints.horizontal);
            }
            if (constraints.vertical !== undefined) {
                constraints.vertical = normalizeVertical(constraints.vertical);
            }

            props[PROPS.constraints] = constraints;
        }
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
