/**
 * @file spacing.ts
 * @description Spacing tokens - Radix Scale (1-9)
 */

export const space = {
  // Radix Scale (primary)
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 40,
  8: 48,
  9: 64,
  // Legacy aliases (for gradual migration)
  none: 0,
  xs: 4,      // → space-1
  sm: 8,      // → space-2
  md: 16,     // → space-4
  lg: 24,     // → space-5
  xl: 32,     // → space-6
  '2xl': 40,  // → space-7
  stack: 12,  // → space-3
} as const;

