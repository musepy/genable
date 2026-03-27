/**
 * @file design-ir.ts
 * @description Canonical types for design properties.
 *
 * Paint values (fills/strokes) use Figma Paint format directly — no intermediate
 * representation. Other complex types (effect, unitValue, constraints, fontName)
 * keep dedicated value types.
 *
 * Simple scalar properties (fontSize, cornerRadius, opacity, etc.) are NOT
 * wrapped — they pass through as raw number/string/boolean values via the
 * index signature on CanonicalProps.
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
  // Paints: Figma Paint[] directly (no IR wrapper)
  fills?: any[];
  strokes?: any[];
  effects?: EffectValue[];
  lineHeight?: UnitValue;
  letterSpacing?: UnitValue;
  constraints?: ConstraintValue;
  fontName?: FontNameValue;

  // All scalar/enum/string properties pass through without wrapping.
  // Examples: fontSize, cornerRadius, opacity, layoutMode, name, characters, etc.
  [key: string]: any;
}
