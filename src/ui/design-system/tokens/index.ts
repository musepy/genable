/**
 * @file index.ts
 * @description Aggregated export for the design system tokens
 */

import { colors } from './colors';
import { space } from './spacing';
import { fontSize, fontWeight, lineHeight, font } from './typography';
import { radii, size, zIndex } from './layout';

// Re-export individual token modules
export * from './css';
export * from './globalStyles';
export * from './colors';
export * from './spacing';
export * from './typography';
export * from './layout';

// Main tokens object
export const tokens = {
  colors,
  space,
  fontSize,
  fontWeight,
  lineHeight,
  size,
  radii,
  font,
  zIndex,
} as const;

export type Tokens = typeof tokens;
