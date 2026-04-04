/**
 * @file tokenScanner.ts
 * @description Scans Figma local variables and styles to produce a TokenSnapshot.
 * Runs on the main thread (Figma API access required).
 * Used by: Memory Diff (compare snapshots), Onboarding (discover design system).
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { rgbaToHex } from '../../utils/colorUtils';

export interface TokenSnapshot {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  spacing: Record<string, number>;
  timestamp: string;
}

/**
 * Scan current file's local variables and styles, return a TokenSnapshot.
 * Limits to 50 most relevant variables if >500 exist.
 */
export async function handleScanTokens(): Promise<ToolResponse> {
  try {
    const snapshot = await buildTokenSnapshot();
    const colorCount = Object.keys(snapshot.colors).length;
    const fontCount = Object.keys(snapshot.fonts).length;
    const spacingCount = Object.keys(snapshot.spacing).length;
    const total = colorCount + fontCount + spacingCount;

    return {
      data: {
        snapshot,
        summary: total === 0
          ? 'No design tokens found in this file.'
          : `Found ${colorCount} colors, ${fontCount} fonts, ${spacingCount} spacing tokens.`,
        tokenCount: total,
      },
    };
  } catch (e) {
    return {
      error: `Token scan failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function buildTokenSnapshot(): Promise<TokenSnapshot> {
  const colors: Record<string, string> = {};
  const fonts: Record<string, string> = {};
  const spacing: Record<string, number> = {};

  // 1. Scan local variables (colors + numbers)
  const allVars = await figma.variables.getLocalVariablesAsync();
  let colorVars = allVars.filter(v => v.resolvedType === 'COLOR');
  const numberVars = allVars.filter(v => v.resolvedType === 'FLOAT');

  // Limit to 50 color variables if too many
  if (colorVars.length > 50) {
    colorVars = colorVars.slice(0, 50);
  }

  // Get collections for mode resolution
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collMap = new Map(collections.map(c => [c.id, c]));

  for (const v of colorVars) {
    const coll = collMap.get(v.variableCollectionId);
    if (!coll || coll.modes.length === 0) continue;
    const defaultModeId = coll.modes[0].modeId;
    const value = v.valuesByMode[defaultModeId];
    if (value && typeof value === 'object' && 'r' in value) {
      const rgb = value as { r: number; g: number; b: number; a?: number };
      colors[v.name] = rgbaToHex(rgb);
    }
  }

  // Extract spacing-like number variables (names containing space/spacing/gap/padding/margin/radius)
  const spacingPattern = /space|spacing|gap|padding|margin|radius|size/i;
  for (const v of numberVars) {
    if (!spacingPattern.test(v.name)) continue;
    const coll = collMap.get(v.variableCollectionId);
    if (!coll || coll.modes.length === 0) continue;
    const defaultModeId = coll.modes[0].modeId;
    const value = v.valuesByMode[defaultModeId];
    if (typeof value === 'number') {
      spacing[v.name] = value;
    }
  }

  // 2. Scan local text styles
  const textStyles = await figma.getLocalTextStylesAsync();
  for (const style of textStyles.slice(0, 20)) {
    fonts[style.name] = `${style.fontName.family}/${style.fontSize}/${style.fontName.style}`;
  }

  // 3. If no text styles, scan local paint styles for additional colors
  if (Object.keys(colors).length === 0) {
    const paintStyles = await figma.getLocalPaintStylesAsync();
    for (const style of paintStyles.slice(0, 50)) {
      if (style.paints.length > 0 && style.paints[0].type === 'SOLID') {
        const paint = style.paints[0] as SolidPaint;
        colors[style.name] = rgbaToHex(paint.color);
      }
    }
  }

  return {
    colors,
    fonts,
    spacing,
    timestamp: new Date().toISOString(),
  };
}

