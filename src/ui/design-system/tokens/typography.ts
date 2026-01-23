/**
 * @file typography.ts
 * @description Typography tokens - 3-Level System (Radix Step 1-3)
 * 
 * PAIRING RULE: fontSize[N] must be used with lineHeight[N]
 */

export const fontSize = {
  // 3-Level System (Radix Step 1-3)
  1: 12,  // Caption, Badge, Helper
  2: 14,  // Body, List, Button (default)
  3: 16,  // Title, Heading
  
  // Extended sizes (rarely needed in plugin)
  4: 18,
  5: 20,
  6: 24,
  
  // Deprecated - will be removed
  /** @deprecated Use fontSize[1] instead */
  xs: 10,     // ❌ Non-standard, violates Radix spec
  /** @deprecated Use fontSize[1] instead */
  sm: 12,     // → fontSize[1]
  /** @deprecated Use fontSize[2] instead */
  base: 14,   // → fontSize[2]
  /** @deprecated Use fontSize[3] instead */
  lg: 16,     // → fontSize[3]
} as const;

/**
 * Line height tokens - MUST pair with fontSize
 * All values are 4px grid aligned
 */
export const lineHeight = {
  // Numeric scale (paired with fontSize)
  1: '16px',  // fontSize[1]: 12px -> 16px (133%)
  2: '20px',  // fontSize[2]: 14px -> 20px (143%)
  3: '24px',  // fontSize[3]: 16px -> 24px (150%)
  4: '26px',  // fontSize[4]: 18px
  5: '28px',  // fontSize[5]: 20px
  6: '32px',  // fontSize[6]: 24px
  
  // Deprecated ratio-based (avoid)
  /** @deprecated Use lineHeight[N] numeric tokens instead */
  tight: '1.1',
  /** @deprecated Use lineHeight[N] numeric tokens instead */
  snug: '1.25',
  /** @deprecated Use lineHeight[N] numeric tokens instead */
  normal: '1.4',
  /** @deprecated Use lineHeight[N] numeric tokens instead */
  relaxed: '1.5',
} as const;

export const fontWeight = {
  normal: 400,    // Body text
  medium: 500,    // Emphasis (static)
  semibold: 600,  // Titles
  bold: 700,      // Strong emphasis
} as const;

export const font = {
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, monospace',
} as const;
