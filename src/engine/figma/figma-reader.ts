/**
 * @file figma-reader.ts
 * @description Reads Figma node property values, filtering invisible items.
 *
 * Paint values stay as Figma Paint format — no IR conversion.
 * Effects and other complex types use PropertySpec conversion.
 */

import { effectSpec } from '../../domain/property-specs';

/**
 * Read fills/strokes — filter invisible, keep Figma Paint format.
 */
export function readPaints(figmaPaints: any): any[] {
  if (!Array.isArray(figmaPaints)) return [];
  return figmaPaints.filter((p: any) => p.visible !== false);
}

/**
 * Read effects — filter invisible, keep Figma Effect format.
 */
export function readEffects(figmaEffects: any): any[] {
  return effectSpec.fromFigma(figmaEffects);
}
