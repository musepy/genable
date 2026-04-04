/**
 * @file index.ts
 * @description Aggregated export for the design system tokens
 */

import { colors } from './colors';
import { space } from './spacing';
import { fontSize, fontWeight, lineHeight, font } from './typography';
import { radii, size, zIndex, grid } from './layout';

// Re-export individual token modules
export * from './css';
export * from './globalStyles';
export * from './colors';
export * from './spacing';
export * from './typography';
export * from './layout';
export { motion } from './motion';

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
  grid,
} as const;

export type Tokens = typeof tokens;
