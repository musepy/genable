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

// Layout tokens for semantic fill/hug/fixed sizing
// Maps Figma layout concepts to CSS flexbox
export const layoutTokens = {
  // Main axis sizing behavior
  sizing: {
    fill: { flex: 1, minWidth: 0 },           // Fill parent container
    hug: { flex: '0 0 auto' },                // Shrink to content
    fixed: (n: number) => ({ width: n, flexShrink: 0 }),
  },
  // Cross-axis alignment
  align: {
    start: 'flex-start' as const,
    center: 'center' as const,
    end: 'flex-end' as const,
    stretch: 'stretch' as const,
  },
  // Main-axis distribution
  justify: {
    start: 'flex-start' as const,
    center: 'center' as const,
    end: 'flex-end' as const,
    between: 'space-between' as const,
  },
  // Common flex patterns
  patterns: {
    row: { display: 'flex', flexDirection: 'row' as const },
    column: { display: 'flex', flexDirection: 'column' as const },
    center: { display: 'flex', alignItems: 'center' as const, justifyContent: 'center' as const },
  },
} as const;
