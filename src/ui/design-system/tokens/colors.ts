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
  // === Backgrounds (step 1-2) ===
  bg1: 'var(--background)',           // gray-1: Page background
  bg2: 'var(--card)',                 // gray-2: Secondary background
  
  // === Surface (step 3-5) ===
  surface: 'var(--muted)',            // gray-3: Component default
  surfaceHover: 'var(--gray-4)',      // gray-4: Hover state
  surfaceActive: 'var(--gray-5)',     // gray-5: Active/pressed state
  
  // === Borders (step 6-8) ===
  borderLight: 'var(--border-subtle)', // gray-4: Subtle border
  border: 'var(--border)',            // gray-6: Default border
  borderHover: 'var(--border-strong)', // gray-7: Hover border
  
  // === Text (step 11-12) ===
  textSecondary: 'var(--muted-foreground)', // gray-11: Secondary text
  textPrimary: 'var(--foreground)',         // gray-12: Primary text
  
  // === Shadows ===
  shadow: 'var(--card-shadow)',
  
  // === P3: Alpha Tokens (transparent overlays) ===
  alpha: {
    1: 'var(--gray-a1)',   // Extremely subtle
    2: 'var(--gray-a2)',   // Very subtle
    3: 'var(--gray-a3)',   // Ghost hover
    4: 'var(--gray-a4)',   // Disabled bg
    5: 'var(--gray-a5)',   // Subtle shadows
    8: 'var(--gray-a8)',   // Medium overlay
    11: 'var(--gray-a11)', // Disabled text
    12: 'var(--gray-a12)', // Strong overlay
  },
  disabled: 'var(--gray-a4)',       // Disabled background
  disabledText: 'var(--gray-a11)',  // Disabled text
  
  // === Semantic Colors ===
  primary: 'var(--primary)',
  primaryForeground: 'var(--primary-foreground)',
  primaryMuted: 'var(--primary-muted)',
  primaryBorder: 'var(--primary-border)',
  
  secondary: 'var(--secondary)',
  secondaryForeground: 'var(--secondary-foreground)',
  
  solid: 'var(--solid)',
  solidForeground: 'var(--solid-foreground)',
  
  accent: 'var(--accent)',
  ring: 'var(--ring)',
  
  success: 'var(--success)',
  successMuted: 'var(--success-muted)',
  successBorder: 'var(--success-border)',
  
  warning: 'var(--warning)',
  warningMuted: 'var(--warning-muted)',
  warningBorder: 'var(--warning-border)',
  
  destructive: 'var(--destructive)',
  destructiveMuted: 'var(--destructive-muted)',
  destructiveBorder: 'var(--destructive-border)',
  
  // === Error Aliases (semantic) ===
  error: 'var(--destructive)',          // Alias for destructive
  errorMuted: 'var(--destructive-muted)',
  errorBorder: 'var(--destructive-border)',

  // === Legacy Aliases (for gradual migration) ===
  /** @deprecated Use bg1 */
  background: 'var(--background)',
  /** @deprecated Use textPrimary */
  foreground: 'var(--foreground)',
  /** @deprecated Use bg2 */
  card: 'var(--card)',
  /** @deprecated Use textPrimary */
  cardForeground: 'var(--card-foreground)',
  /** @deprecated Use shadow */
  cardShadow: 'var(--card-shadow)',
  /** @deprecated Use surface */
  muted: 'var(--muted)',
  /** @deprecated Use textSecondary */
  mutedForeground: 'var(--muted-foreground)',
  /** @deprecated Use borderLight */
  borderSubtle: 'var(--border-subtle)',
  /** @deprecated Use borderHover */
  borderStrong: 'var(--border-strong)',
} as const;

