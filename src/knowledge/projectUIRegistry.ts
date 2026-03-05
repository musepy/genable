/**
 * @file projectUIRegistry.ts
 * @description Project design tokens for LLM context injection.
 *
 * Provides design system token values (colors, spacing, typography, radius)
 * that the LLM can query via query_knowledge(source: "tokens").
 */

export const PROJECT_DESIGN_TOKENS = {
  colors: {
    background: 'var(--color-background)',
    surface: 'var(--color-surface)',
    textPrimary: 'var(--gray-12)',
    textSecondary: 'var(--gray-11)',
    accent: 'var(--accent-9)',
    error: 'var(--error-9)',
    border: 'var(--gray-6)',
  },
  spacing: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 24,
    6: 32,
  },
  typography: {
    fontSize: { 1: 12, 2: 14, 3: 16 },
    fontWeight: { regular: 400, medium: 500, semibold: 600 },
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  radius: {
    small: 4,
    medium: 6,
    large: 8,
    full: 9999,
  },
};
