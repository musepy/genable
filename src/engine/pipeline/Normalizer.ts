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

        // 1. Normalize Type
        this.normalizeType(layer);

        // 2. Context-Indepenent "Hallucination" Fixing (Lifting props)
        this.liftProps(layer);

        // 3. Property Transformation (Aliases & Coercion)
        this.normalizePropertyAliases(layer.props);
        this.coercePropertyValues(layer.props);
        this.normalizeEnums(layer.props);

        // 4. Recursive for children
        if (Array.isArray(layer.children)) {
            if (layer.children.length === 0) {
                delete (layer as any).children;
            } else {
                layer.children = layer.children.map((child: any) => this.processNode(child));
            }
        }

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

        const type = layer.type.toUpperCase();
        const TYPE_MAP: Record<string, string> = {
            'COMPONENT': NODE_TYPES.FRAME,
            'COMPONENT_SET': NODE_TYPES.FRAME,
            'INSTANCE': NODE_TYPES.FRAME,
            'BOOLEAN_OPERATION': NODE_TYPES.FRAME,
            'POLYGON': NODE_TYPES.RECTANGLE,
            'STAR': NODE_TYPES.RECTANGLE,
            'ICON': 'ICON'
        };

        if (TYPE_MAP[type]) {
            if (type !== TYPE_MAP[type]) this.logFix(layer, `Type coerced: ${type} -> ${TYPE_MAP[type]}`);
            layer.type = TYPE_MAP[type];
        } else if (!Object.values(NODE_TYPES).includes(type as any)) {
            this.logFix(layer, `Unknown type "${type}" coerced to FRAME`);
            layer.type = NODE_TYPES.FRAME;
        } else {
            layer.type = type;
        }
    }

    private static liftProps(layer: any): void {
        const KEYS_TO_LIFT = [
            PROPS.semantic, PROPS.layoutMode, 'layout', 'style', 
            PROPS.layoutSizingHorizontal, PROPS.layoutSizingVertical, 
            PROPS.gap, PROPS.padding, PROPS.width, PROPS.height, 
            PROPS.fills, PROPS.cornerRadius, 'role', PROPS.name
        ];

        KEYS_TO_LIFT.forEach(key => {
            if (layer[key] !== undefined && layer.props[key] === undefined) {
                layer.props[key] = layer[key];
            }
        });

        const flatten = (source: any) => {
            if (typeof source === 'object' && source !== null) {
                Object.assign(layer.props, source);
                return true;
            }
            return false;
        };

        if (flatten(layer.layout)) delete layer.layout;
        if (flatten(layer.style)) delete layer.style;
        if (flatten(layer.props.style)) delete layer.props.style;
        if (typeof layer.props.layout === 'object') flatten(layer.props.layout); 
    }

    private static normalizePropertyAliases(props: any): void {
        const aliases: Record<string, string> = RUNTIME_CONFIG.propertyAliases || {};
        
        for (const [alias, target] of Object.entries(aliases)) {
            if (props[alias] !== undefined && props[target] === undefined) {
                let value = props[alias];
                if ((target === 'fills' || target === 'strokes') && !Array.isArray(value)) {
                    value = [value];
                }
                props[target] = value;
                delete props[alias];
            }
        }

        // Nested mapping for effects
        if (Array.isArray(props.effects)) {
            props.effects.forEach((eff: any) => {
                for (const [alias, target] of Object.entries(aliases)) {
                    if (eff[alias] !== undefined && eff[target] === undefined) {
                        eff[target] = eff[alias];
                    }
                }
            });
        }
    }

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

        // Specific legacy bridge: characters vs content
        if (props.content && !props.characters) {
            props.characters = props.content;
        }

        // Color Arrays
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

    private static normalizeEnums(props: any): void {
        const ENUM_MAPS: Record<string, Record<string, string>> = {
            [PROPS.layoutMode]: {
                'VERTICAL': LAYOUT_MODES.VERTICAL, 'VERT': LAYOUT_MODES.VERTICAL, 'COL': LAYOUT_MODES.VERTICAL, 'COLUMN': LAYOUT_MODES.VERTICAL,
                'HORIZONTAL': LAYOUT_MODES.HORIZONTAL, 'HORZ': LAYOUT_MODES.HORIZONTAL, 'ROW': LAYOUT_MODES.HORIZONTAL,
                'NONE': LAYOUT_MODES.NONE
            },
            [PROPS.layoutSizingHorizontal]: {
                'FIXED': SIZING_MODES.FIXED, 'FILL': SIZING_MODES.FILL, 'HUG': SIZING_MODES.HUG,
                'AUTO': SIZING_MODES.HUG, 'STRETCH': SIZING_MODES.FILL
            },
            [PROPS.layoutSizingVertical]: {
                'FIXED': SIZING_MODES.FIXED, 'FILL': SIZING_MODES.FILL, 'HUG': SIZING_MODES.HUG,
                'AUTO': SIZING_MODES.HUG, 'STRETCH': SIZING_MODES.FILL
            }
        };

        for (const [prop, map] of Object.entries(ENUM_MAPS)) {
            if (props[prop]) {
                const val = String(props[prop]).toUpperCase().trim();
                if (map[val]) {
                    props[prop] = map[val];
                } else {
                    // [Fix] Specific fallback for layoutMode
                    if (prop === PROPS.layoutMode) {
                        props[prop] = LAYOUT_MODES.NONE;
                    } else {
                        // [Fix] Remove invalid enum values to prevent Zod failures
                        delete props[prop];
                    }
                }
            }
        }

        // Semantic casing
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
