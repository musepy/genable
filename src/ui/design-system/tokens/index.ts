/**
 * @file index.ts
 * @description Aggregated export for the design system tokens
 */

import { colors } from './colors';
import { space } from './spacing';
import { fontSize, fontWeight, lineHeight, font } from './typography';
import { radii, size } from './layout';

// Re-export individual token modules
export * from './css';
export * from './colors';
export * from './spacing';
export * from './typography';
export * from './layout';
export * from './motion';
export * from './components';

// Main tokens object (Backwards compatibility)
export const tokens = {
  colors,
  space,
  fontSize,
  fontWeight,
  lineHeight,
  size,
  radii,
  font,
} as const;

export type Tokens = typeof tokens;
export type MotionTokens = typeof import('./motion').motionTokens;
export type InteractionTokens = typeof import('./motion').interactionTokens;
export type LayoutTokens = typeof import('./layout').layoutTokens;
export type ComponentStyles = typeof import('./components').componentStyles;

