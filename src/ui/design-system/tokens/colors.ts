/**
 * @file colors.ts
 * @description Semantic color tokens - Vercel Geist style naming
 * 
 * Naming Convention:
 * - bg1/bg2: Page backgrounds
 * - surface/surfaceHover/surfaceActive: Component backgrounds (step 3→4→5)
 * - border/borderHover/borderActive: Borders (step 6→7→8)
 * - textPrimary/textSecondary: Text colors (step 12/11)
 */

export const colors = {
  // === Radix Themes UI Roles ===
  background: 'var(--color-background)',
  surface: 'var(--color-surface)',
  surfaceHover: 'var(--gray-4)',
  surfaceActive: 'var(--gray-5)',
  panel: 'var(--color-panel)',
  overlay: 'var(--color-overlay)',
  shadow: 'var(--color-shadow)',
  disabled: 'var(--gray-a4)',
  disabledText: 'var(--gray-a11)',

  // === Accent Scale (Interactive) ===
  accent: 'var(--accent-9)',
  accentContrast: '#ffffff',
  accentMuted: 'var(--accent-3)',
  accentBorder: 'var(--accent-6)',
  accentBorderHover: 'var(--accent-7)',
  ring: 'var(--accent-a8)',
  
  // === Gray Scale (Neutral) ===
  gray: 'var(--gray-9)',
  grayContrast: '#ffffff',
  grayMuted: 'var(--gray-3)',
  grayBorder: 'var(--gray-6)',
  grayBorderHover: 'var(--gray-7)',
  textPrimary: 'var(--gray-12)',
  textSecondary: 'var(--gray-11)',
  
  // === Functional Scales ===
  success: 'var(--success-9)',
  successMuted: 'var(--success-3)',
  successBorder: 'var(--success-6)',
  
  warning: 'var(--warning-9)',
  warningMuted: 'var(--warning-3)',
  warningBorder: 'var(--warning-6)',
  
  error: 'var(--error-9)',
  errorMuted: 'var(--error-3)',
  errorBorder: 'var(--error-6)',

  // === Alpha Tokens ===
  alpha: {
    1: 'var(--gray-a1)',
    2: 'var(--gray-a2)',
    3: 'var(--gray-a3)',
    4: 'var(--gray-a4)',
    5: 'var(--gray-a5)',
    8: 'var(--gray-a8)',
    11: 'var(--gray-a11)',
    12: 'var(--gray-a12)',
  },
  accentAlpha: {
    1: 'var(--accent-a1)',
    2: 'var(--accent-a2)',
    3: 'var(--accent-a3)',
    4: 'var(--accent-a4)',
    5: 'var(--accent-a5)',
    8: 'var(--accent-a8)',
    11: 'var(--accent-a11)',
    12: 'var(--accent-a12)',
  },
} as const;

