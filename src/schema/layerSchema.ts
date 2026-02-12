/**
 * @file layerSchema.ts
 * @description Runtime Schema Validation for NodeLayer DSL
 * 
 * [INPUT]:  Raw JSON from LLM
 * [OUTPUT]: Validated NodeLayer or ValidationError
 * [POS]:    Schema - used by postProcessor before processing
 * 
 * Uses Valibot for runtime type validation (Tree-shakable, BigInt-free)
 */

import * as v from 'valibot';
import { PROPS, NODE_TYPES, LAYOUT_MODES, SIZING_MODES } from '../constants/figma-api';
import { Normalizer } from '../engine/pipeline/Normalizer';

// ==========================================
// PRIMITIVE SCHEMAS
// ==========================================

/**
 * Layout sizing modes
 */
export const LayoutSizingSchema = v.picklist([SIZING_MODES.FILL, SIZING_MODES.HUG, SIZING_MODES.FIXED]);
export type LayoutSizing = v.InferOutput<typeof LayoutSizingSchema>;

/**
 * Layout directions
 */
export const LayoutModeSchema = v.picklist([LAYOUT_MODES.VERTICAL, LAYOUT_MODES.HORIZONTAL, LAYOUT_MODES.NONE]);
export type LayoutMode = v.InferOutput<typeof LayoutModeSchema>;

/**
 * Axis alignment options
 */
export const AxisAlignSchema = v.picklist(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN', 'BASELINE']);

/**
 * Auto-layout child positioning
 */
export const LayoutPositioningSchema = v.picklist(['AUTO', 'ABSOLUTE']);

/**
 * Constraint axes (allow canonical and common alias labels from design tools)
 */
export const HorizontalConstraintSchema = v.picklist(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'LEFT', 'RIGHT', 'LEFT_RIGHT']);
export const VerticalConstraintSchema = v.picklist(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'TOP', 'BOTTOM', 'TOP_BOTTOM']);

/**
 * Stroke alignment
 */
export const StrokeAlignSchema = v.picklist(['INSIDE', 'OUTSIDE', 'CENTER']);

export const SemanticTypeSchema = v.optional(v.string());

// ==========================================
// COMPLEX TYPE SCHEMAS
// ==========================================

/**
 * Line height can be a number or an object with unit
 */
export const LineHeightSchema = v.union([
    v.number(),
    v.string(),
    v.object({
        value: v.number(),
        unit: v.picklist(['PERCENT', 'PIXELS'])
    })
]);

/**
 * Padding can be a number or an object with sides
 */
export const PaddingSchema = v.union([
    v.number(),
    v.string(), // Support tokens
    v.object({
        top: v.optional(v.union([v.number(), v.string()])),
        right: v.optional(v.union([v.number(), v.string()])),
        bottom: v.optional(v.union([v.number(), v.string()])),
        left: v.optional(v.union([v.number(), v.string()]))
    })
]);

/**
 * Effect schema (shadows, blurs)
 */
export const EffectSchema = v.object({
    type: v.picklist(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR']),
    color: v.optional(v.string()),
    offset: v.optional(v.object({
        x: v.number(),
        y: v.number()
    })),
    blur: v.optional(v.number()),
    spread: v.optional(v.number())
});

// ==========================================
// NODE LAYER SCHEMA
// ==========================================

/**
 * NodeLayer props schema
 * Uses looseObject to allow unknown properties (forward compatibility/passthrough)
 */
export const NodeLayerPropsSchema = v.looseObject({
    // Common
    [PROPS.name]: v.optional(v.string()),
    [PROPS.semantic]: SemanticTypeSchema,
    [PROPS.width]: v.optional(v.number()),
    [PROPS.height]: v.optional(v.number()),

    // Layout sizing
    [PROPS.layoutSizingHorizontal]: v.optional(LayoutSizingSchema),
    [PROPS.layoutSizingVertical]: v.optional(LayoutSizingSchema),
    [PROPS.layoutPositioning]: v.optional(LayoutPositioningSchema),
    [PROPS.layoutGrow]: v.optional(v.union([v.number(), v.string()])),
    [PROPS.layoutAlign]: v.optional(v.picklist(['MIN', 'CENTER', 'MAX', 'STRETCH', 'INHERIT'])),
    [PROPS.constraints]: v.optional(v.object({
        horizontal: v.optional(HorizontalConstraintSchema),
        vertical: v.optional(VerticalConstraintSchema)
    })),
    [PROPS.x]: v.optional(v.union([v.number(), v.string()])),
    [PROPS.y]: v.optional(v.union([v.number(), v.string()])),

    // Frame-specific: AutoLayout
    [PROPS.layoutMode]: v.optional(LayoutModeSchema),
    [PROPS.gap]: v.optional(v.union([v.number(), v.string()])),
    [PROPS.padding]: v.optional(PaddingSchema),
    [PROPS.paddingTop]: v.optional(v.union([v.number(), v.string()])),
    [PROPS.paddingRight]: v.optional(v.union([v.number(), v.string()])),
    [PROPS.paddingBottom]: v.optional(v.union([v.number(), v.string()])),
    [PROPS.paddingLeft]: v.optional(v.union([v.number(), v.string()])),
    [PROPS.primaryAxisAlignItems]: v.optional(AxisAlignSchema),
    [PROPS.counterAxisAlignItems]: v.optional(AxisAlignSchema),
    
    // Appearance
    [PROPS.fills]: v.optional(v.array(v.string())),
    [PROPS.strokes]: v.optional(v.array(v.string())),
    [PROPS.strokeWeight]: v.optional(v.union([v.number(), v.string()])),
    [PROPS.strokeAlign]: v.optional(StrokeAlignSchema),
    [PROPS.cornerRadius]: v.optional(v.union([v.number(), v.string()])),
    [PROPS.cornerSmoothing]: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
    [PROPS.effects]: v.optional(v.array(EffectSchema)),

    // Text-specific
    [PROPS.characters]: v.optional(v.string()),
    [PROPS.fontFamily]: v.optional(v.string()),
    [PROPS.fontWeight]: v.optional(v.string()),
    [PROPS.fontSize]: v.optional(v.number()),
    [PROPS.lineHeight]: v.optional(LineHeightSchema),

    // Icon-specific (for Iconify integration)
    [PROPS.iconName]: v.optional(v.string()),  // Format: "prefix:name" e.g. "mdi:home"
    [PROPS.svgContent]: v.optional(v.string()), // Embedded SVG (after prefetch). INTERNAL, not from LLM.
    
    // V4: State & Interactive
    state: v.optional(v.picklist(['default', 'hover', 'active', 'disabled'])),

    // V5: Token Slot System (DTSS Strategy B)
    [PROPS.variant]: v.optional(v.string())
});

export type NodeLayerProps = v.InferOutput<typeof NodeLayerPropsSchema>;

/**
 * NodeLayer DSL schema (recursive)
 */
export const NodeLayerSchema: v.GenericSchema<any> = v.lazy(() =>
    v.object({
        type: v.picklist([
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
        id: v.optional(v.string()), // Unique identifier for reconciliation
        props: NodeLayerPropsSchema,
        children: v.optional(v.array(NodeLayerSchema))
    })
);

// Alias for transition from older schema.ts
export const NodeSchema = NodeLayerSchema;

export type NodeLayer = v.InferOutput<typeof NodeLayerSchema>;

// ==========================================
// FLAT NODE SCHEMA (Adjacency List)
// ==========================================

/**
 * Flat Node schema
 * Used by LLM to output a flat list of nodes with explicit parent references
 */
export const FlatNodeSchema = v.object({
    id: v.string(), // Semantic ID, e.g., 'header-nav-logo'
    parent: v.nullable(v.string()), // ID of the parent node, or null for root
    type: v.picklist([
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
export const FlatNodeArraySchema = v.array(FlatNodeSchema);

export type FlatNode = v.InferOutput<typeof FlatNodeSchema>;

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
    const result = v.safeParse(NodeLayerSchema, input);

    if (result.success) {
        return { success: true, data: result.output as NodeLayer };
    }

    // Format errors for debugging
    const errors = result.issues.map(issue => {
        // Valibot issues have .path as an array of items with .key
        const path = issue.path?.map((item: any) => item.key).join('.') || 'root';
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
    return v.safeParse(NodeLayerSchema, input).success;
}

// ==========================================
// VALIDATION FUNCTIONS
// ==========================================

/**
 * Coerce LLM output to valid schema
 * Now delegates to the centralized Normalizer service.
 */
export function coerceNodeLayer(input: unknown, observer?: { log: (phase: string, msg: string, details?: any) => void }): NodeLayer {
    // Normalizer handles structure, lifting, aliases and types
    return Normalizer.normalize(input);
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
        // Handle coercion errors specifically
        return {
            success: false,
            errors: [`Coercion failed: ${e}`]
        };
    }
}
