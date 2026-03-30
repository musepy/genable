/**
 * @file figma-lowering.ts
 * @description Converts property values to Figma API-ready format.
 *
 * Paint values use direct Figma format — no IR layer. Accepts strings,
 * LLM object syntax ({color, blendMode, opacity}), and raw Figma Paints.
 */

import { parseHexToRGBA } from '../../utils/colorUtils';
import { unitValueSpec, parsePaintToFigma, parseEffectToFigma } from '../../domain/property-specs';
import type { UnitValue } from '../../domain/property-specs';

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
 * Convert an array of effect inputs to Figma Effect[] format.
 *
 * Accepts:
 *   - "0,4,8,0,#00000040"      → drop shadow
 *   - "blur(10)"               → layer blur
 *   - {type:'DROP_SHADOW', …}  → already Figma Effect, normalize
 */
export function lowerEffects(effects: any[]): any[] {
  return effects.map(item => {
    if (typeof item === 'string') return parseEffectToFigma(item);
    if (typeof item !== 'object' || item === null || !item.type) {
      throw new Error(`Invalid effect format: ${JSON.stringify(item)}`);
    }
    // Figma Effect object — fill defaults
    const e: any = { ...item };
    if ('blur' in e && !('radius' in e)) { e.radius = e.blur; delete e.blur; }
    if (typeof e.color === 'string') e.color = parseHexToRGBA(e.color);
    if (!e.blendMode && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')) e.blendMode = 'NORMAL';
    if (e.visible === undefined) e.visible = true;
    if ((e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && !e.offset) e.offset = { x: 0, y: 0 };
    return e;
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
