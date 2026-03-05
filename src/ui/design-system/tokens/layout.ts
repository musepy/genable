/**
 * @file layout.ts
 * @description Layout and sizing tokens
 */

export const radii = {
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
  xl: 'var(--radius-xl)',
  '2xl': 'var(--radius-2xl)',
  full: 'var(--radius-full)',
} as const;

export const size = {
  button: {
    xs: 28,    // Compact icon button (legacy)
    sm: 32,
    md: 32,    // Radix space[6] - compact for Figma plugin
    lg: 44,    // HIG standard touch target
    xl: 48,    // Large CTA option
  },
  input: {
    sm: 32,
    md: 36,
    lg: 44,    // HIG standard touch target
    xl: 48,
  },
  icon: {
    sm: 16,
    md: 20,
    lg: 24,
  },
} as const;

export const zIndex = {
  base: 0,
  popover: 100,
  toast: 1000,
  modal: 1100,
} as const;
