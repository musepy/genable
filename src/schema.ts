import { z } from 'zod';

// ==========================================
// 1. Resilient Primitives (Auto-Healing)
// ==========================================

export const ColorSchema = z.string().describe("Hex code (#RRGGBB) or Variable reference (Variable:Name)");

// Helper to normalize strings to uppercase, generic fallback
const normalizeEnum = (val: unknown, validOptions: string[], fallback: string) => {
  if (typeof val === 'string') {
    const upper = val.toUpperCase().trim();
    if (validOptions.includes(upper)) return upper;
    // Common aliases mapping
    if (upper === 'ROW') return 'HORIZONTAL';
    if (upper === 'COL' || upper === 'COLUMN') return 'VERTICAL';
    if (upper === 'AUTO') return 'HUG';
    if (upper === 'STRETCH') return 'FILL';
  }
  return fallback;
};

export const LayoutModeSchema = z.preprocess(
  (val) => normalizeEnum(val, ['VERTICAL', 'HORIZONTAL', 'NONE'], 'NONE'),
  z.enum(['VERTICAL', 'HORIZONTAL', 'NONE'])
);

export const AlignSchema = z.preprocess(
  (val) => normalizeEnum(val, ['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN'], 'MIN'),
  z.enum(['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN'])
);

export const SizingModeSchema = z.preprocess(
  (val) => normalizeEnum(val, ['FIXED', 'HUG', 'FILL'], 'FIXED'),
  z.enum(['FIXED', 'HUG', 'FILL'])
);

// Size can be a String (FILL/FIXED/HUG) OR a Number (Pixels)
export const SizeInputSchema = z.union([
    z.string().transform(s => {
        const upper = s.toUpperCase().trim();
        if (['FILL', 'FIXED', 'HUG', 'AUTO', 'STRETCH'].includes(upper)) {
           if (upper === 'AUTO') return 'HUG';
           if (upper === 'STRETCH') return 'FILL';
           return upper as 'FILL' | 'FIXED' | 'HUG';
        }
        return 'HUG'; // Fallback
    }),
    z.number()
]);

// ==========================================
// 2. Component Props
// ==========================================

const BaseProps = z.object({
  name: z.string().optional(),
  // Semantic Intent (New): Helps the Sanitizer make smart decisions
  semantic: z.enum(['DEFAULT', 'PARAGRAPH', 'HEADING', 'LABEL', 'BUTTON', 'CARD', 'LIST', 'ICON']).optional().default('DEFAULT'),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
});

export const FramePropsSchema = BaseProps.extend({
  layout: LayoutModeSchema.optional().default('NONE'),
  
  // Advanced Sizing
  layoutSizingHorizontal: SizingModeSchema.optional(),
  layoutSizingVertical: SizingModeSchema.optional(),
  
  // Explicit dimensions (used when sizing is FIXED)
  width: z.number().optional(),
  height: z.number().optional(),

  // Constraints
  minWidth: z.number().optional(),
  maxWidth: z.number().optional(),
  minHeight: z.number().optional(),
  maxHeight: z.number().optional(),

  // Auto Layout Properties
  gap: z.number().optional(),
  padding: z.union([
    z.number(),
    z.object({
      top: z.number().default(0),
      right: z.number().default(0),
      bottom: z.number().default(0),
      left: z.number().default(0)
    })
  ]).optional(),

  primaryAxisAlignItems: AlignSchema.optional(),
  counterAxisAlignItems: AlignSchema.optional(),
  itemReverseZIndex: z.boolean().optional(),
  strokesIncludedInLayout: z.boolean().optional(),

  // Styling
  fills: z.array(ColorSchema).optional(),
  stroke: ColorSchema.optional(),
  strokeWeight: z.number().optional(),
  strokeAlign: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional().default('INSIDE'),
  
  cornerRadius: z.union([
    z.number(),
    z.object({
      topLeft: z.number().default(0),
      topRight: z.number().default(0),
      bottomRight: z.number().default(0),
      bottomLeft: z.number().default(0)
    })
  ]).optional(),
  
  effects: z.array(z.object({
    type: z.literal('DROP_SHADOW'),
    color: ColorSchema,
    offset: z.object({x: z.number(), y: z.number()}),
    blur: z.number(),
    spread: z.number().optional()
  })).optional(),
});

export const TextPropsSchema = BaseProps.extend({
  content: z.string().optional().default("Text"),
  fontFamily: z.string().optional().default("Inter"),
  fontWeight: z.preprocess((val) => {
    if (typeof val === 'number') {
      if (val <= 300) return 'Light';
      if (val <= 400) return 'Regular';
      if (val <= 500) return 'Medium';
      if (val <= 600) return 'SemiBold';
      if (val >= 700) return 'Bold';
    }
    if (typeof val === 'string') {
      const lower = val.toLowerCase();
      if (lower.includes('thin')) return 'Thin';
      if (lower.includes('extra') && lower.includes('light')) return 'ExtraLight';
      if (lower.includes('light')) return 'Light';
      if (lower.includes('medium')) return 'Medium';
      if (lower.includes('semi') && lower.includes('bold')) return 'SemiBold';
      if (lower.includes('extra') && lower.includes('bold')) return 'ExtraBold';
      if (lower.includes('bold')) return 'Bold';
      if (lower.includes('black')) return 'Black';
    }
    return 'Regular';
  }, z.enum(['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black'])),

  fontSize: z.number().optional().default(16),
  textAlign: z.preprocess(
    (val) => normalizeEnum(val, ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'], 'LEFT'),
    z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'])
  ).optional(),
  
  // Text Auto Resize behavior
  textAutoResize: z.enum(['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT']).optional(), 
  // NONE = Fixed size
  // HEIGHT = Auto Height (Fixed Width)
  // WIDTH_AND_HEIGHT = Auto Width (Single line)

  color: ColorSchema.optional(),
  width: z.number().optional(),
  layoutSizingHorizontal: SizingModeSchema.optional(),
  layoutSizingVertical: SizingModeSchema.optional(),
});

export const VectorPropsSchema = BaseProps.extend({
  svgData: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  layoutSizingHorizontal: SizingModeSchema.optional(),
  layoutSizingVertical: SizingModeSchema.optional(),
});

// ==========================================
// 3. Node Union
// ==========================================

export const NodeSchema: z.ZodType<any> = z.lazy(() => 
  z.union([
    z.object({ type: z.literal('FRAME'), props: FramePropsSchema, children: z.array(NodeSchema).optional() }),
    z.object({ type: z.literal('TEXT'), props: TextPropsSchema }),
    z.object({ type: z.literal('VECTOR'), props: VectorPropsSchema }),
  ])
);

export type NodeLayer = z.infer<typeof NodeSchema>;