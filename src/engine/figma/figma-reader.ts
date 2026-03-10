/**
 * @file figma-reader.ts
 * @description Converts Figma node property values to Canonical IR values using PropertySpecs.
 *
 * Replaces PropertyTransformer.serialize() for complex types (paint, effect, unitValue).
 * Simple scalars continue to pass through directly.
 */

import type { PaintValue, EffectValue, UnitValue, FontNameValue } from '../../domain/design-ir';
import { paintSpec, effectSpec, unitValueSpec, fontNameSpec } from '../../domain/property-specs';

/**
 * Read fills/strokes from a Figma Paint[] into canonical PaintValue[].
 * Never returns null — returns empty array for no fills.
 */
export function readPaints(figmaPaints: any): PaintValue[] {
  return paintSpec.fromFigma(figmaPaints);
}

/**
 * Read effects from a Figma Effect[] into canonical EffectValue[].
 */
export function readEffects(figmaEffects: any): EffectValue[] {
  return effectSpec.fromFigma(figmaEffects);
}

/**
 * Read lineHeight/letterSpacing from Figma {value, unit} into canonical UnitValue.
 */
export function readUnitValue(figmaValue: any): UnitValue {
  return unitValueSpec.fromFigma(figmaValue);
}

/**
 * Read fontName from Figma FontName into canonical FontNameValue.
 */
export function readFontName(figmaFontName: any): FontNameValue {
  return fontNameSpec.fromFigma(figmaFontName);
}
