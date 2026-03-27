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
import { NODE_TYPES, getEnumInputs } from '../constants/figma-api';

// ==========================================
// PRIMITIVE SCHEMAS
// ==========================================

// Derive enum picklists from PROP_METADATA (single source of truth)
const enumPicklist = (prop: string) =>
  v.picklist(getEnumInputs(prop) as [string, ...string[]]);

export const LayoutSizingSchema = enumPicklist('layoutSizingHorizontal');
export type LayoutSizing = v.InferOutput<typeof LayoutSizingSchema>;

export const LayoutModeSchema = enumPicklist('layoutMode');
export type LayoutMode = v.InferOutput<typeof LayoutModeSchema>;

export const PrimaryAxisAlignSchema = enumPicklist('primaryAxisAlignItems');
export const CounterAxisAlignSchema = enumPicklist('counterAxisAlignItems');

export const LayoutPositioningSchema = enumPicklist('layoutPositioning');

/**
 * Constraint axes (allow canonical and common alias labels from design tools)
 * Not derived — constraints are an object type, not a simple enum in PROP_METADATA.
 */
export const HorizontalConstraintSchema = v.picklist(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'LEFT', 'RIGHT', 'LEFT_RIGHT']);
export const VerticalConstraintSchema = v.picklist(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE', 'TOP', 'BOTTOM', 'TOP_BOTTOM']);

export const StrokeAlignSchema = enumPicklist('strokeAlign');

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
 * Gradient color stop
 */
export const GradientStopSchema = v.object({
    position: v.number(),  // 0.0 to 1.0
    color: v.string()      // hex color, e.g. "#FF0000" or "#FF000080"
});

/**
 * Gradient fill definition (linear, radial, angular, diamond)
 */
export const GradientFillSchema = v.object({
    type: v.picklist(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']),
    stops: v.array(GradientStopSchema),
    angle: v.optional(v.number())  // degrees: 0=left→right, 90=top→bottom, 180=right→left
});

/**
 * A fill item: either a hex color string or a gradient object
 */
export const FillItemSchema = v.union([v.string(), GradientFillSchema]);

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
    name: v.optional(v.string()),
    semantic: SemanticTypeSchema,
    width: v.optional(v.number()),
    height: v.optional(v.number()),

    // Layout sizing
    layoutSizingHorizontal: v.optional(LayoutSizingSchema),
    layoutSizingVertical: v.optional(LayoutSizingSchema),
    layoutPositioning: v.optional(LayoutPositioningSchema),
    layoutGrow: v.optional(v.union([v.number(), v.string()])),
    layoutAlign: v.optional(enumPicklist('layoutAlign')),
    constraints: v.optional(v.object({
        horizontal: v.optional(HorizontalConstraintSchema),
        vertical: v.optional(VerticalConstraintSchema)
    })),
    x: v.optional(v.union([v.number(), v.string()])),
    y: v.optional(v.union([v.number(), v.string()])),

    // Frame-specific: AutoLayout
    layoutMode: v.optional(LayoutModeSchema),
    gap: v.optional(v.union([v.number(), v.string()])),
    padding: v.optional(PaddingSchema),
    paddingTop: v.optional(v.union([v.number(), v.string()])),
    paddingRight: v.optional(v.union([v.number(), v.string()])),
    paddingBottom: v.optional(v.union([v.number(), v.string()])),
    paddingLeft: v.optional(v.union([v.number(), v.string()])),
    primaryAxisAlignItems: v.optional(PrimaryAxisAlignSchema),
    counterAxisAlignItems: v.optional(CounterAxisAlignSchema),

    // Appearance
    fills: v.optional(v.array(FillItemSchema)),
    strokes: v.optional(v.array(v.string())),
    strokeWeight: v.optional(v.union([v.number(), v.string()])),
    strokeAlign: v.optional(StrokeAlignSchema),
    cornerRadius: v.optional(v.union([v.number(), v.string()])),
    cornerSmoothing: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
    effects: v.optional(v.array(EffectSchema)),

    // Text-specific
    characters: v.optional(v.string()),
    fontFamily: v.optional(v.string()),
    fontWeight: v.optional(v.string()),
    fontSize: v.optional(v.number()),
    lineHeight: v.optional(LineHeightSchema),

    // Icon-specific (for Iconify integration)
    iconName: v.optional(v.string()),  // Format: "prefix:name" e.g. "mdi:home"
    svgContent: v.optional(v.string()), // Embedded SVG (after prefetch). INTERNAL, not from LLM.

    // V4: State & Interactive
    state: v.optional(v.picklist(['default', 'hover', 'active', 'disabled'])),

    // V5: Token Slot System (DTSS Strategy B)
    variant: v.optional(v.string())
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
            NODE_TYPES.ICON,
            NODE_TYPES.COMPONENT,
            NODE_TYPES.COMPONENT_SET,
            NODE_TYPES.INSTANCE,
            NODE_TYPES.STAR,
            NODE_TYPES.POLYGON,
            NODE_TYPES.BOOLEAN_OPERATION,
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
        NODE_TYPES.ICON,
        NODE_TYPES.COMPONENT,
        NODE_TYPES.COMPONENT_SET,
        NODE_TYPES.INSTANCE,
        NODE_TYPES.STAR,
        NODE_TYPES.POLYGON,
        NODE_TYPES.BOOLEAN_OPERATION,
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
        return { data: result.output as NodeLayer };
    }

    // Format errors for debugging
    const errors = result.issues.map(issue => {
        // Valibot issues have .path as an array of items with .key
        const path = issue.path?.map((item: any) => item.key).join('.') || 'root';
        return `[${path}] ${issue.message}`;
    });

    return { errors };
}

/**
 * Validate and throw on error (for strict mode)
 */
export function validateNodeLayerStrict(input: unknown): NodeLayer {
    const result = validateNodeLayer(input);

    if (result.errors) {
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
