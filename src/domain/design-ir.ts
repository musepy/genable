/**
 * @file design-ir.ts
 * @description Canonical Intermediate Representation for design properties.
 *
 * All layers (XML parser, interpreter, executor, serializer) operate through
 * these types. Each property has a single canonical form defined here.
 *
 * Simple scalar properties (fontSize, cornerRadius, opacity, etc.) are NOT
 * wrapped — they pass through as raw number/string/boolean values via the
 * index signature on CanonicalProps. Only complex types (paint, effect,
 * unitValue, constraints, fontName) get dedicated value types.
 */

// ── RGBA color (Figma 0-1 range) ──

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Vector {
  x: number;
  y: number;
}

// ── Gradient ──

export type GradientType = 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';

export interface ColorStop {
  color: RGBA;
  position: number;
}

// ── Paint value (discriminated union) ──

export type PaintValue =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; type: GradientType; stops: ColorStop[]; angle?: number }
  | { kind: 'image'; imageHash: string; scaleMode: string };

// ── Effect value (discriminated union) ──

export type EffectValue =
  | { kind: 'drop-shadow'; color: RGBA; offset: Vector; radius: number; spread: number }
  | { kind: 'inner-shadow'; color: RGBA; offset: Vector; radius: number; spread: number }
  | { kind: 'blur'; type: 'layer' | 'background'; radius: number };

// ── Unit value ──

export type UnitType = 'PIXELS' | 'PERCENT' | 'AUTO';

export interface UnitValue {
  value: number;
  unit: UnitType;
}

// ── Constraint value ──

export type ConstraintType = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';

export interface ConstraintValue {
  horizontal: ConstraintType;
  vertical: ConstraintType;
}

// ── Font name ──

export interface FontNameValue {
  family: string;
  style: string;
}

// ── CanonicalProps ──

export interface CanonicalProps {
  // Complex typed properties
  fills?: PaintValue[];
  strokes?: PaintValue[];
  effects?: EffectValue[];
  lineHeight?: UnitValue;
  letterSpacing?: UnitValue;
  constraints?: ConstraintValue;
  fontName?: FontNameValue;

  // All scalar/enum/string properties pass through without wrapping.
  // Examples: fontSize, cornerRadius, opacity, layoutMode, name, characters, etc.
  [key: string]: any;
}

// ── OperationIR (replaces ParsedLine at the semantic layer) ──

export interface OperationIR {
  /** The operation to perform */
  command: 'create' | 'update' | 'delete' | 'icon' | 'image' | 'instance';
  /** For create: the Figma node type (FRAME, TEXT, RECTANGLE, etc.) */
  nodeType?: string;
  /** Parent node reference (symbol or Figma ID) */
  parentRef?: string;
  /** For update/delete: the target node reference */
  targetRef?: string;
  /** Binding symbol for this node */
  symbol?: string;
  /** Symbol references this operation depends on */
  dependsOn: string[];
  /** Canonical properties */
  props: CanonicalProps;
  /** For instance: the component reference */
  componentRef?: string;
  /** For instance: child overrides */
  overrides?: Record<string, CanonicalProps>;
  /** If true, creates a ComponentNode instead of a FrameNode */
  reusable?: boolean;
  /** 1-based operation index (diagnostic) */
  lineNumber?: number;
  /** JSON summary of the original operation (diagnostic) */
  raw?: string;
}
