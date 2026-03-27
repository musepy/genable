/**
 * @file figma-reader.ts
 * @description Reads Figma node property values, filtering invisible items.
 *
 * Paint values stay as Figma Paint format — no IR conversion.
 * Effects and other complex types use PropertySpec conversion.
 */

import type { EffectValue, UnitValue, FontNameValue } from '../../domain/design-ir';
import { effectSpec, unitValueSpec, fontNameSpec } from '../../domain/property-specs';

/**
 * Read fills/strokes — filter invisible, keep Figma Paint format.
 */
export function readPaints(figmaPaints: any): any[] {
  if (!Array.isArray(figmaPaints)) return [];
  return figmaPaints.filter((p: any) => p.visible !== false);
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
