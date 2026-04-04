/**
 * @file motion.ts
 * @description Reusable transition & animation primitives.
 *
 * Three categories:
 *   1. disclosure()  — CSS Grid 0fr↔1fr height animation (accordions, drawers)
 *   2. rotate()      — transform rotate for chevrons / icons
 *   3. fade()        — opacity + scale for show/hide without unmounting
 *
 * All durations in ms, easing via CSS variable --ease-in-out.
 * Usage: `style={motion.disclosure(isOpen)}` or `style={motion.rotate(isOpen, 90)}`
 */

const EASE = 'var(--ease-in-out)';

// ─── Duration presets (ms) ───────────────────────────────
export const duration = {
  crisp:  150,   // quick micro-interactions
  normal: 220,   // standard accordion / toggle
  slow:   300,   // emphasis, large panels
} as const;

// ─── 1. Disclosure (CSS Grid accordion) ─────────────────
// Container: wraps the content area; animates grid-template-rows.
// Content:   must be the direct child; overflow:hidden + minHeight:0.

export function disclosure(open: boolean, ms: number = duration.normal): Record<string, string> {
  return {
    display: 'grid',
    gridTemplateRows: open ? '1fr' : '0fr',
    transition: `grid-template-rows ${ms}ms ${EASE}`,
  };
}

/** Direct child of disclosure() — required for 0fr to collapse properly. */
export const disclosureContent: Record<string, string | number> = {
  overflow: 'hidden',
  minHeight: 0,
};

// ─── 2. Rotate (chevrons, icons) ────────────────────────
// Single element stays mounted; rotates between 0 and `deg`.

export function rotate(open: boolean, deg: number = 180, ms: number = duration.crisp): Record<string, string> {
  return {
    display: 'inline-flex',
    transition: `transform ${ms}ms ${EASE}`,
    transform: open ? `rotate(${deg}deg)` : 'rotate(0deg)',
  };
}

// ─── 3. Fade (show/hide without unmount) ────────────────
// Element stays in DOM; opacity + subtle scale toggle.

export function fade(visible: boolean, ms: number = duration.crisp): Record<string, string> {
  return {
    opacity: visible ? '1' : '0',
    transition: `opacity ${ms}ms ${EASE}, transform ${ms}ms ${EASE}`,
    transform: visible ? 'none' : 'scale(0.97)',
    pointerEvents: visible ? 'auto' : 'none',
  };
}

// ─── Aggregated export ──────────────────────────────────

export const motion = {
  duration,
  disclosure,
  disclosureContent,
  rotate,
  fade,
} as const;
