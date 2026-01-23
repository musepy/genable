/**
 * @file layerSchema.ts
 * @description Runtime Schema Validation for NodeLayer DSL
 * 
 * [INPUT]:  Raw JSON from LLM
 * [OUTPUT]: Validated NodeLayer or ValidationError
 * [POS]:    Schema - used by postProcessor before processing
 * 
 * Uses Zod for runtime type validation to ensure:
 * 1. LLM output matches expected structure
 * 2. Type mismatches are caught early
 * 3. Clear error messages for debugging
 */

import { z } from 'zod';
import { PROPS, NODE_TYPES, LAYOUT_MODES, SIZING_MODES } from '../constants/figma-api';

// ==========================================
// PRIMITIVE SCHEMAS
// ==========================================

/**
 * Layout sizing modes
 */
export const LayoutSizingSchema = z.enum([SIZING_MODES.FILL, SIZING_MODES.HUG, SIZING_MODES.FIXED]);
export type LayoutSizing = z.infer<typeof LayoutSizingSchema>;

/**
 * Layout directions
 */
export const LayoutModeSchema = z.enum([LAYOUT_MODES.VERTICAL, LAYOUT_MODES.HORIZONTAL, LAYOUT_MODES.NONE]);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

/**
 * Axis alignment options
 */
export const AxisAlignSchema = z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN', 'BASELINE']);

/**
 * Stroke alignment
 */
export const StrokeAlignSchema = z.enum(['INSIDE', 'OUTSIDE', 'CENTER']);

export const SemanticTypeSchema = z.string().optional();

// ==========================================
// COMPLEX TYPE SCHEMAS
// ==========================================

/**
 * Line height can be a number or an object with unit
 */
export const LineHeightSchema = z.union([
    z.number(),
    z.string(),
    z.object({
        value: z.number(),
        unit: z.enum(['PERCENT', 'PIXELS'])
    })
]);

/**
 * Padding can be a number or an object with sides
 */
export const PaddingSchema = z.union([
    z.number(),
    z.string(), // Support tokens
    z.object({
        top: z.union([z.number(), z.string()]).optional(),
        right: z.union([z.number(), z.string()]).optional(),
        bottom: z.union([z.number(), z.string()]).optional(),
        left: z.union([z.number(), z.string()]).optional()
    })
]);

/**
 * Effect schema (shadows, blurs)
 */
export const EffectSchema = z.object({
    type: z.enum(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR']),
    color: z.string().optional(),
    offset: z.object({
        x: z.number(),
        y: z.number()
    }).optional(),
    blur: z.number().optional(),
    spread: z.number().optional()
});

// ==========================================
// NODE LAYER SCHEMA
// ==========================================

/**
 * NodeLayer props schema
 */
export const NodeLayerPropsSchema = z.object({
    // Common
    [PROPS.name]: z.string().optional(),
    [PROPS.semantic]: SemanticTypeSchema,
    [PROPS.width]: z.number().optional(),
    [PROPS.height]: z.number().optional(),

    // Layout sizing
    [PROPS.layoutSizingHorizontal]: LayoutSizingSchema.optional(),
    [PROPS.layoutSizingVertical]: LayoutSizingSchema.optional(),

    // Frame-specific: AutoLayout
    [PROPS.layoutMode]: LayoutModeSchema.optional(),
    [PROPS.gap]: z.union([z.number(), z.string()]).optional(),
    [PROPS.padding]: PaddingSchema.optional(),
    [PROPS.paddingTop]: z.union([z.number(), z.string()]).optional(),
    [PROPS.paddingRight]: z.union([z.number(), z.string()]).optional(),
    [PROPS.paddingBottom]: z.union([z.number(), z.string()]).optional(),
    [PROPS.paddingLeft]: z.union([z.number(), z.string()]).optional(),
    [PROPS.primaryAxisAlignItems]: AxisAlignSchema.optional(),
    [PROPS.counterAxisAlignItems]: AxisAlignSchema.optional(),
    
    // Appearance
    [PROPS.fills]: z.array(z.string()).optional(),
    [PROPS.strokes]: z.array(z.string()).optional(),
    [PROPS.strokeWeight]: z.union([z.number(), z.string()]).optional(),
    [PROPS.strokeAlign]: StrokeAlignSchema.optional(),
    [PROPS.cornerRadius]: z.union([z.number(), z.string()]).optional(),
    [PROPS.cornerSmoothing]: z.number().min(0).max(1).optional(),
    [PROPS.effects]: z.array(EffectSchema).optional(),

    // Text-specific
    [PROPS.characters]: z.string().optional(),
    [PROPS.fontFamily]: z.string().optional(),
    [PROPS.fontWeight]: z.string().optional(),
    [PROPS.fontSize]: z.number().optional(),
    [PROPS.lineHeight]: LineHeightSchema.optional(),
    // Legacy support (optional, or removed? Plan says mapped, so maybe redundant here. Keeping optional for safety)
    // [PROPS.fills] covers color.

    // Icon-specific (for Iconify integration)
    [PROPS.iconName]: z.string().optional(),  // Format: "prefix:name" e.g. "mdi:home"
    [PROPS.svgContent]: z.string().optional(), // Embedded SVG (after prefetch). INTERNAL, not from LLM.
    
    // V4: State & Interactive
    state: z.enum(['default', 'hover', 'active', 'disabled']).optional(),

    // V5: Token Slot System (DTSS Strategy B)
    [PROPS.variant]: z.string().optional()
}).passthrough(); // Allow unknown props for forward compatibility

export type NodeLayerProps = z.infer<typeof NodeLayerPropsSchema>;

/**
 * NodeLayer DSL schema (recursive)
 */
export const NodeLayerSchema: z.ZodType<any> = z.lazy(() =>
    z.object({
        type: z.enum([
            NODE_TYPES.FRAME, 
            NODE_TYPES.TEXT, 
            NODE_TYPES.VECTOR, 
            NODE_TYPES.RECTANGLE, 
            NODE_TYPES.LINE, 
            NODE_TYPES.ELLIPSE, 
            NODE_TYPES.GROUP, 
            NODE_TYPES.SECTION, 
            NODE_TYPES.ICON
        ]),
        props: NodeLayerPropsSchema,
        children: z.array(NodeLayerSchema).optional()
    })
);

// Alias for transition from older schema.ts
export const NodeSchema = NodeLayerSchema;

export type NodeLayer = z.infer<typeof NodeLayerSchema>;

// ==========================================
// FLAT NODE SCHEMA (Adjacency List)
// ==========================================

/**
 * Flat Node schema
 * Used by LLM to output a flat list of nodes with explicit parent references
 */
export const FlatNodeSchema = z.object({
    id: z.string().describe("Semantic ID, e.g., 'header-nav-logo'"),
    parent: z.string().nullable().describe("ID of the parent node, or null for root"),
    type: z.enum([
        NODE_TYPES.FRAME, 
        NODE_TYPES.TEXT, 
        NODE_TYPES.VECTOR, 
        NODE_TYPES.RECTANGLE, 
        NODE_TYPES.LINE, 
        NODE_TYPES.ELLIPSE, 
        NODE_TYPES.GROUP, 
        NODE_TYPES.SECTION, 
        NODE_TYPES.ICON
    ]),
    props: NodeLayerPropsSchema
});

/**
 * Array of flat nodes - the target structure for LLM generation
 */
export const FlatNodeArraySchema = z.array(FlatNodeSchema);

export type FlatNode = z.infer<typeof FlatNodeSchema>;

// ==========================================
// VALIDATION FUNCTIONS
// ==========================================

/**
 * Validation result type
 */
export interface ValidationResult<T> {
    success: boolean;
    data?: T;
    errors?: string[];
}

/**
 * Validate a NodeLayer DSL from LLM
 * 
 * @param input - Raw JSON from LLM
 * @returns Validated NodeLayer or error messages
 */
export function validateNodeLayer(input: unknown): ValidationResult<NodeLayer> {
    const result = NodeLayerSchema.safeParse(input);

    if (result.success) {
        return { success: true, data: result.data };
    }

    // Format errors for debugging
    const errors = result.error.issues.map(issue => {
        const path = issue.path.join('.');
        return `[${path}] ${issue.message}`;
    });

    return { success: false, errors };
}

/**
 * Validate and throw on error (for strict mode)
 */
export function validateNodeLayerStrict(input: unknown): NodeLayer {
    const result = validateNodeLayer(input);

    if (!result.success) {
        const errorMsg = result.errors?.join('\n') || 'Unknown validation error';
        throw new Error(`NodeLayer validation failed:\n${errorMsg}`);
    }

    return result.data!;
}

/**
 * Type guard for NodeLayer
 */
export function isValidNodeLayer(input: unknown): input is NodeLayer {
    return NodeLayerSchema.safeParse(input).success;
}

// ==========================================
// COERCION FUNCTIONS
// ==========================================

// ==========================================
// COERCION FUNCTIONS
// ==========================================

/**
 * Coerce LLM output to valid schema
 * Attempts to fix common issues automatically
 * [P3.1] Now logs all coercion actions to FlowObserver
 */
/**
 * Coerce LLM output to valid schema
 * Attempts to fix common issues automatically
 * [P3.1] Now logs all coercion actions to FlowObserver
 */
export function coerceNodeLayer(input: unknown, observer?: { log: (phase: string, msg: string, details?: any) => void }): NodeLayer {
    const warnings: string[] = [];
    
    // [CRITICAL FIX] Handle LLM returning array instead of object
    let inputToProcess = input;
    if (Array.isArray(input)) {
        warnings.push(`[Coercion] LLM returned array with ${input.length} items, wrapping in FRAME container`);
        inputToProcess = {
            type: NODE_TYPES.FRAME,
            props: {
                [PROPS.name]: 'Generated Container'
            },
            children: input
        };
        observer?.log('SCHEMA_WARNING', 'LLM returned array, wrapped in FRAME container', { originalCount: input.length });
    }
    
    // [STABILITY FIX] Ensure input is an object.
    if (typeof inputToProcess !== 'object' || inputToProcess === null) {
        warnings.push('[Coercion] Input is not an object, returning default FRAME');
        return {
            type: NODE_TYPES.FRAME,
            props: { [PROPS.name]: 'Recovered Node', [PROPS.semantic]: 'DEFAULT' },
            children: []
        };
    }

    // Deep clone to avoid mutation
    const layer = JSON.parse(JSON.stringify(inputToProcess));

    // [SCHEMA HARMONIZATION] Move top-level LLM-hallucinated keys into 'props'
    if (!layer.props) layer.props = {};
    
    const topLevelPropsToMove = [
        PROPS.semantic, PROPS.layoutMode, 'layout', 'style', 
        PROPS.layoutSizingHorizontal, PROPS.layoutSizingVertical, 
        PROPS.gap, PROPS.padding, PROPS.width, PROPS.height, 
        PROPS.fills, PROPS.cornerRadius, 'role', 'id', PROPS.name
    ];
    
    // [Pure Trust] Allow all properties to pass through to passthrough() props
    // Removal of unsupported properties is deferred to the Renderer.

    topLevelPropsToMove.forEach(key => {
        if (layer[key] !== undefined && layer.props[key] === undefined) {
            layer.props[key] = layer[key];
        }
    });

    // Special Case: Flatten "style" or "layout" objects if they exist
    if (typeof layer.layout === 'object' && layer.layout !== null) {
        Object.assign(layer.props, layer.layout);
    }
    if (typeof layer.style === 'object' && layer.style !== null) {
        Object.assign(layer.props, layer.style);
    }
    if (typeof layer.props.style === 'object' && layer.props.style !== null) {
        Object.assign(layer.props, layer.props.style);
        delete layer.props.style;
    }
    if (typeof layer.props.layout === 'object' && layer.props.layout !== null) {
        Object.assign(layer.props, layer.props.layout);
        // Do not delete if enum
        if (typeof layer.props.layout === 'object') delete layer.props.layout;
    }

    const props = layer.props;



    // [CONFIG COERCION] Apply Runtime Config Aliases
    // This allows non-code updates to alias rules (e.g. radius -> blur vs blur -> radius)
    try {
        // Dynamic requiring of JSON config
        const RUNTIME_CONFIG = require('../config/runtime-coercion.json');
        
        if (RUNTIME_CONFIG && RUNTIME_CONFIG.propertyAliases) {
            for (const [alias, target] of Object.entries(RUNTIME_CONFIG.propertyAliases)) {
                // If nested property (e.g. effect.blur), handling is complex. 
                // Currently supporting top-level props or simple recursive strategy later.
                // For now, let's look at direct props.
                
                // 1. Direct Prop Mapping
                if (props[alias] !== undefined && props[target as string] === undefined) {
                    let value = props[alias];
                    // [FIX] Auto-wrap single values for array targets (fills/strokes)
                    if ((target === 'fills' || target === 'strokes') && !Array.isArray(value)) {
                        value = [value];
                    }
                    props[target as string] = value;
                    delete props[alias];
                    warnings.push(`[Config] Coerced "${alias}" -> "${target}"`);
                }
                
                // 2. Special Case: Effects Array Mapping (Recursive-ish)
                // If target is internal to an object array (like effect.radius)
                // This naive loop assumes flat props. Special handling for nested structures below.
            }

            // Special Handling for Effects (Nested Objects)
            if (Array.isArray(props.effects)) {
                props.effects.forEach((eff: any) => {
                    for (const [alias, target] of Object.entries(RUNTIME_CONFIG.propertyAliases)) {
                        if (eff[alias] !== undefined && eff[target as string] === undefined) {
                            eff[target as string] = eff[alias];
                            // delete eff[alias]; // Optional: cleaning up
                        }
                    }
                });
            }
        }
    } catch (e) {
        // Config might not exist or be readable in some environments, ignore gracefully
        // console.warn('[layerSchema] Failed to load runtime-coercion.json', e);
    }

    // Helper: Ensure number or token
    const ensureNumber = (val: any, fieldName: string): number | string | undefined => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            if (val.startsWith('$')) {
                // Return raw token string (DTS Strategy B)
                return val;
            }
            const parsed = parseFloat(val);
            if (!isNaN(parsed)) {
                return parsed;
            }
        }
        return undefined;
    };

    // Helper: Normalize Enum
    const normalizeEnum = (val: any, field: string, map: Record<string, string>, strict: boolean = false): string | undefined => {
        if (!val) return undefined;
        const normalized = String(val).toUpperCase().trim();
        if (map[normalized]) {
            const mapped = map[normalized];
            if (mapped !== val) warnings.push(`Coerced ${field}: "${val}" -> ${mapped}`);
            return mapped;
        }
        return strict ? undefined : normalized;
    };

    // 1. Coerce type to uppercase and normalize
    if (typeof layer.type === 'string') {
        const original = layer.type;
        layer.type = layer.type.toUpperCase();
        
        const TYPE_MAP: Record<string, string> = {
            'COMPONENT': NODE_TYPES.FRAME,
            'COMPONENT_SET': NODE_TYPES.FRAME,
            'INSTANCE': NODE_TYPES.FRAME,
            'BOOLEAN_OPERATION': NODE_TYPES.FRAME,
            'POLYGON': NODE_TYPES.RECTANGLE,
            'STAR': NODE_TYPES.RECTANGLE,
            [NODE_TYPES.FRAME]: NODE_TYPES.FRAME,
            [NODE_TYPES.TEXT]: NODE_TYPES.TEXT,
            [NODE_TYPES.VECTOR]: NODE_TYPES.VECTOR,
            [NODE_TYPES.RECTANGLE]: NODE_TYPES.RECTANGLE,
            [NODE_TYPES.LINE]: NODE_TYPES.LINE,
            [NODE_TYPES.ELLIPSE]: NODE_TYPES.ELLIPSE,
            [NODE_TYPES.GROUP]: NODE_TYPES.GROUP,
            [NODE_TYPES.SECTION]: NODE_TYPES.SECTION,
            [NODE_TYPES.ICON]: 'ICON', // Internal type
        };
        
        const mappedType = TYPE_MAP[layer.type];
        if (mappedType) {
            if (layer.type !== mappedType) warnings.push(`Type coerced: ${original} → ${mappedType}`);
            layer.type = mappedType;
        } else {
            warnings.push(`Unknown type "${original}" coerced to FRAME`);
            layer.type = NODE_TYPES.FRAME;
        }
    }

    // 2. Filter Illegal Properties
    if (layer.type !== NODE_TYPES.FRAME && layer.children) {
        // Only FRAMEs have children in our DSL (normally)
        if (layer.type !== 'GROUP' && layer.type !== 'SECTION') { // Just in case
             // warnings.push(`Removed illegal 'children' from ${layer.type} node`);
             // delete layer.children; 
             // Actually, let's keep it lenient for now or delete? 
             // Strict schema says only recursive on NodeLayerSchema which allows children?
             // No, schema definition allows children on any node technically, but renderer handles Frame mostly.
        }
    }

    // 5. Numeric Coercion (Pure Trust: No Grid Alignment)

    if (props[PROPS.width] !== undefined) props[PROPS.width] = ensureNumber(props[PROPS.width], 'width');
    if (props[PROPS.height] !== undefined) props[PROPS.height] = ensureNumber(props[PROPS.height], 'height');
    
    // Gap
    if (props[PROPS.gap] !== undefined && !(typeof props[PROPS.gap] === 'string' && props[PROPS.gap].startsWith('$'))) {
        props[PROPS.gap] = ensureNumber(props[PROPS.gap], 'gap');
    }
    // Stroke Weight
    if (props[PROPS.strokeWeight] !== undefined) props[PROPS.strokeWeight] = ensureNumber(props[PROPS.strokeWeight], 'strokeWeight');
    // Corner Radius
    if (props[PROPS.cornerRadius] !== undefined && !(typeof props[PROPS.cornerRadius] === 'string' && props[PROPS.cornerRadius].startsWith('$'))) {
        props[PROPS.cornerRadius] = ensureNumber(props[PROPS.cornerRadius], 'cornerRadius');
    }
    // Font Size
    if (props[PROPS.fontSize] !== undefined) props[PROPS.fontSize] = ensureNumber(props[PROPS.fontSize], 'fontSize');

    // Padding Handling
    if (props[PROPS.padding] !== undefined) {
        if (typeof props[PROPS.padding] === 'string') {
            if (props[PROPS.padding].startsWith('$')) {
                warnings.push(`[Token] padding: "${props[PROPS.padding]}" resolved later`);
            } else {
                const parsed = parseFloat(props[PROPS.padding]);
                if (isNaN(parsed)) {
                    props[PROPS.padding] = 0;
                } else {
                    props[PROPS.padding] = parsed;
                }
            }
        }
        
        if (typeof props[PROPS.padding] === 'object') {
            props[PROPS.padding] = {
                top: ensureNumber(props[PROPS.padding].top, 'padding.top'),
                right: ensureNumber(props[PROPS.padding].right, 'padding.right'),
                bottom: ensureNumber(props[PROPS.padding].bottom, 'padding.bottom'),
                left: ensureNumber(props[PROPS.padding].left, 'padding.left'),
            };
        }
    }

    // Individual Padding Coercion
    [PROPS.paddingTop, PROPS.paddingRight, PROPS.paddingBottom, PROPS.paddingLeft].forEach(prop => {
        if (props[prop] !== undefined) {
            props[prop] = ensureNumber(props[prop], prop);
        }
    });

    // 6. Enum Normalization
    
    // Layout Mode
    const layoutMap: Record<string, string> = {
        'VERTICAL': LAYOUT_MODES.VERTICAL, 'VERT': LAYOUT_MODES.VERTICAL, 'COL': LAYOUT_MODES.VERTICAL,
        'HORIZONTAL': LAYOUT_MODES.HORIZONTAL, 'HORZ': LAYOUT_MODES.HORIZONTAL, 'ROW': LAYOUT_MODES.HORIZONTAL,
        'NONE': LAYOUT_MODES.NONE
    };
    if (props[PROPS.layoutMode]) {
        const mapped = normalizeEnum(props[PROPS.layoutMode], 'layoutMode', layoutMap, true);
        if (mapped) props[PROPS.layoutMode] = mapped;
        else {
             props[PROPS.layoutMode] = LAYOUT_MODES.NONE;
        }
    }

    // Sizing Mode
    const sizingMap: Record<string, string> = {
        'FIXED': SIZING_MODES.FIXED, 'FILL': SIZING_MODES.FILL, 'HUG': SIZING_MODES.HUG,
        'AUTO': SIZING_MODES.HUG, 'STRETCH': SIZING_MODES.FILL
    };
    if (props[PROPS.layoutSizingHorizontal]) props[PROPS.layoutSizingHorizontal] = normalizeEnum(props[PROPS.layoutSizingHorizontal], 'layoutSizingHorizontal', sizingMap, true);
    if (props[PROPS.layoutSizingVertical]) props[PROPS.layoutSizingVertical] = normalizeEnum(props[PROPS.layoutSizingVertical], 'layoutSizingVertical', sizingMap, true);

    // Axis Alignments
    const axisAlignMap: Record<string, string> = {
        'MIN': 'MIN', 'CENTER': 'CENTER', 'MAX': 'MAX', 
        'SPACE_BETWEEN': 'SPACE_BETWEEN', 'BASELINE': 'BASELINE',
        'START': 'MIN', 'LEFT': 'MIN', 'TOP': 'MIN',
        'END': 'MAX', 'RIGHT': 'MAX', 'BOTTOM': 'MAX',
        'SPACE-BETWEEN': 'SPACE_BETWEEN', 'SPACEBETWEEN': 'SPACE_BETWEEN'
    };
    if (props[PROPS.primaryAxisAlignItems]) {
        const val = normalizeEnum(props[PROPS.primaryAxisAlignItems], 'primaryAxis', axisAlignMap, true);
        props[PROPS.primaryAxisAlignItems] = val || 'MIN';
    }
    if (props[PROPS.counterAxisAlignItems]) {
        const val = normalizeEnum(props[PROPS.counterAxisAlignItems], 'counterAxis', axisAlignMap, true);
        props[PROPS.counterAxisAlignItems] = val || 'MIN';
    }

    // 6.2 [Pure Trust] No implicit Auto Layout repair or property injection.
    // Structural integrity is trusted to the LLM.

    // Semantic Type Normalization (Open String Strategy)
    if (props[PROPS.semantic]) {
        // Just normalize case and spacing, but keep the original intent
        props[PROPS.semantic] = String(props[PROPS.semantic]).toUpperCase().trim().replace(/ /g, '_');
    }

    // Defaults for TEXT (Intent-Preserving)
    if (layer.type === NODE_TYPES.TEXT) {
        // No hardcoded "Text" defaults. Let the LLM or Skill provide content.
        
        // Font Size/Weight defaults are REMOVED from schema.
        // If missing, they will be handled by the Renderer or PostProcessor
        // based on the specific Design System in use.
    }

    // [Pure Trust] Post-Sizing Cleanup (Hallucination Guard) REMOVED.
    // Width/Height are preserved even if HUG/FILL is present to maintain data fidelity.

    // [Pure Trust] Icon Prefixing REMOVED.
    // Handling icon library prefixes is the responsibility of the specialized Skills or Renderer.

    // 7. Visual Array Coercion (SSOT Alignment)
    // Fills Array Coercion
    if (Array.isArray(props[PROPS.fills])) {
        props[PROPS.fills] = props[PROPS.fills].map((fill: any) => {
            if (typeof fill === 'string') return fill;
            if (typeof fill === 'object' && fill !== null) return fill.color || fill.value || fill.hex;
            return fill;
        }).filter((f: any) => typeof f === 'string' && f.length > 0);
    }

    // Strokes Array Coercion
    if (Array.isArray(props[PROPS.strokes])) {
        props[PROPS.strokes] = props[PROPS.strokes].map((stroke: any) => {
            if (typeof stroke === 'string') return stroke;
            if (typeof stroke === 'object' && stroke !== null) return stroke.color || stroke.value || stroke.hex;
            return stroke;
        }).filter((f: any) => typeof f === 'string' && f.length > 0);
    }

    if (observer && warnings.length > 0) {
        observer.log('SCHEMA_WARNING', `Coerced ${warnings.length} issues in node "${props[PROPS.name] || 'unnamed'}"`, warnings);
    }

    // Recursion & Self-Healing
    if (Array.isArray(layer.children)) {
        if (layer.children.length === 0) {
            // [Self-Healing] If children is empty, delete the field to prevent structural violations
            delete (layer as any).children;
        } else {
            layer.children = layer.children.map((child: unknown) => coerceNodeLayer(child, observer));
        }
    }

    return layer;
}

/**
 * Validate with auto-coercion
 * First tries to coerce, then validates
 */
export function validateWithCoercion(input: unknown): ValidationResult<NodeLayer> {
    try {
        const coerced = coerceNodeLayer(input);
        return validateNodeLayer(coerced);
    } catch (e) {
        return {
            success: false,
            errors: [`Coercion failed: ${e}`]
        };
    }
}
