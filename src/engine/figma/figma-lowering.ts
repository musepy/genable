/**
 * @file figma-lowering.ts
 * @description Converts property values to Figma API-ready format.
 *
 * Paint values use direct Figma format — no IR layer. Accepts strings,
 * LLM object syntax ({color, blendMode, opacity}), and raw Figma Paints.
 */

import type { EffectValue, UnitValue } from '../../domain/design-ir';
import { effectSpec, unitValueSpec, parsePaintToFigma } from '../../domain/property-specs';
import { parseHexToRGBA } from '../../domain/property-specs';

/**
 * Convert an array of paint inputs to Figma Paint[] format.
 *
 * Accepts:
 *   - "#FF0000"                    → solid paint
 *   - "linear-gradient(…)"         → gradient paint
 *   - {color:"#F00", opacity:0.5}  → solid paint with explicit props
 *   - {type:'SOLID', …}            → already Figma Paint, pass through
 */
export function lowerPaints(paints: any[]): any[] {
  return paints.map(item => {
    if (typeof item === 'string') return parsePaintToFigma(item);
    if (typeof item === 'object' && item !== null) {
      // Already a Figma Paint (has 'type' field)
      if ('type' in item) return item;
      // LLM object syntax: {color, blendMode, opacity}
      return parsePaintToFigma(item);
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
