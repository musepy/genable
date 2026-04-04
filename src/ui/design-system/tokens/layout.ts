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

/**
 * Alignment grid — plugin-wide text alignment constants.
 *
 * All text across Chat, Settings, Onboarding aligns to the same vertical edges:
 *   TEXT_LEFT  = scrollPad + blockPad = 22px
 *   TEXT_RIGHT = PLUGIN_WIDTH - scrollPad - blockPad = 318px
 *
 * Elements INSIDE scroll area: use `padding: Npx ${blockPad}px`
 * Elements OUTSIDE scroll area: use `padding: Npx ${scrollPad + blockPad}px`
 * Borders: use `box-shadow: inset 0 0 0 0.5px` to avoid 1px offset
 */
const _scrollPad = 12; // = space[3]
const _blockPad = 10;
const _pluginW = 340;

export const grid = {
  /** Plugin window width */
  pluginWidth: _pluginW,
  /** Scroll container / page horizontal padding */
  scrollPad: _scrollPad,
  /** Content block horizontal padding (inside scroll area) */
  blockPad: _blockPad,
  /** Absolute text left edge: scrollPad + blockPad */
  textLeft: _scrollPad + _blockPad,       // 22
  /** Absolute text right edge */
  textRight: _pluginW - _scrollPad - _blockPad, // 318
  /** Full horizontal pad for elements OUTSIDE scroll area */
  outerPad: _scrollPad + _blockPad,        // 22
} as const;

export const zIndex = {
  base: 0,
  popover: 100,
  toast: 1000,
  modal: 1100,
} as const;
