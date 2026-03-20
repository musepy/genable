/**
 * @file figma-lowering.ts
 * @description Converts Canonical IR property values to Figma API-ready values.
 *
 * Centralizes all IR → Figma conversion in one place, replacing the scattered
 * normalization logic in executor.ts (normalizePaints, normalizeEffects, etc.).
 *
 * Used by executor.ts's applyProps to convert IR values before Figma API assignment.
 */

import type { PaintValue, EffectValue, UnitValue } from '../../domain/design-ir';
import { paintSpec, effectSpec, unitValueSpec } from '../../domain/property-specs';
import { parseHexToRGBA } from '../../domain/property-specs';
import { isGradientString, parseGradient, getGradientTransform } from '../../domain/gradient-parser';

/**
 * Convert an array of paint values to Figma Paint[] format.
 *
 * Accepts both:
 *   - PaintValue[] (canonical IR from xml-interpreter)
 *   - string[] | mixed[] (legacy format from xmlDesignParser — hex strings or raw Paint objects)
 *
 * This dual-format support enables gradual migration without breaking existing pipeline.
 */
export function lowerPaints(paints: any[]): any[] {
  return paints.map(item => {
    // Canonical IR PaintValue (has 'kind' discriminant)
    if (typeof item === 'object' && item !== null && 'kind' in item) {
      return paintSpec.toFigma([item as PaintValue])[0];
    }
    // CSS gradient string → gradient paint
    if (typeof item === 'string' && isGradientString(item)) {
      const parsed = parseGradient(item);
      if (parsed) {
        return {
          type: parsed.type,
          gradientStops: parsed.stops.map(s => ({ color: s.color, position: s.position })),
          gradientTransform: getGradientTransform(parsed.type, parsed.angleDeg),
        };
      }
    }
    // Legacy: hex string → solid paint via figma.util.solidPaint (Figma runtime only)
    if (typeof item === 'string') {
      // If figma.util.solidPaint is available (runtime), use it for correctness
      if (typeof figma !== 'undefined' && figma.util?.solidPaint) {
        return figma.util.solidPaint(item);
      }
      // Fallback: manual conversion
      const rgba = parseHexToRGBA(item);
      return { type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a };
    }
    // Legacy: raw Paint object — pass through
    if (typeof item === 'object' && item !== null) {
      return item;
    }
    throw new Error(`Invalid paint format: ${JSON.stringify(item)}`);
  });
}

/**
 * Convert an array of effect values to Figma Effect[] format.
 *
 * Accepts both:
 *   - EffectValue[] (canonical IR from xml-interpreter)
 *   - raw Effect objects (legacy format from xmlDesignParser)
 */
export function lowerEffects(effects: any[]): any[] {
  return effects.map(item => {
    // Canonical IR EffectValue (has 'kind' discriminant)
    if (typeof item === 'object' && item !== null && 'kind' in item) {
      return effectSpec.toFigma([item as EffectValue])[0];
    }
    // Legacy: raw Effect object — normalize
    if (typeof item !== 'object' || item === null || !item.type) {
      throw new Error(`Invalid effect format: ${JSON.stringify(item)}`);
    }
    const normalized: any = { ...item };
    // Convert legacy "blur" to "radius"
    if ('blur' in normalized && !('radius' in normalized)) {
      normalized.radius = normalized.blur;
      delete normalized.blur;
    }
    // Convert hex color string to RGBA object
    if (typeof normalized.color === 'string') {
      const rgba = parseHexToRGBA(normalized.color);
      normalized.color = rgba;
    }
    // Defaults
    if (!normalized.blendMode) normalized.blendMode = 'NORMAL';
    if (normalized.visible === undefined) normalized.visible = true;
    if ((normalized.type === 'DROP_SHADOW' || normalized.type === 'INNER_SHADOW') && !normalized.offset) {
      normalized.offset = { x: 0, y: 0 };
    }
    return normalized;
  });
}

/**
 * Convert a unit value (lineHeight, letterSpacing) to Figma {value, unit} format.
 *
 * Accepts:
 *   - UnitValue (canonical IR)
 *   - number (legacy: pixels)
 *   - string (legacy: "160%" → PERCENT, "24" → PIXELS)
 */
export function lowerUnitValue(value: any): { value: number; unit: string } {
  // Canonical IR UnitValue (has 'unit' property)
  if (typeof value === 'object' && value !== null && 'unit' in value && 'value' in value) {
    return unitValueSpec.toFigma(value as UnitValue);
  }
  // Legacy: string percentage
  if (typeof value === 'string' && value.endsWith('%')) {
    return { value: parseFloat(value), unit: 'PERCENT' };
  }
  // Legacy: number or numeric string → pixels
  return { value: Number(value), unit: 'PIXELS' };
}
