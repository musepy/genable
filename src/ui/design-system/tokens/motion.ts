/**
 * @file motion.ts
 * @description Motion and interaction tokens
 */

// Philosophy: "快、精准、清爽" (fast, precise, crisp)
export const motionTokens = {
  transition: {
    // Instant - no animation
    instant: { duration: 0 },
    // Crisp - primary interactions (toggle, buttons)
    crisp: { type: 'spring' as const, stiffness: 800, damping: 35 },
    // Smooth - secondary animations (expand/collapse)
    smooth: { type: 'spring' as const, stiffness: 300, damping: 30 },
  }
} as const;

// Interaction state tokens for unified hover/pressed/disabled
// Following Material Design 3 state layer pattern
export const interactionTokens = {
  hover: {
    // Background overlay for interactive elements
    overlayOpacity: 0.08,  // 8% overlay per MD3
    borderColor: 'var(--gray-8)',
    shadow: '0 2px 4px rgba(0,0,0,0.08)',
  },
  pressed: {
    overlayOpacity: 0.12,  // 12% overlay per MD3
  },
  focused: {
    ring: '0 0 0 2px var(--color-background), 0 0 0 4px var(--accent-a8)',
  },
  disabled: {
    opacity: 0.5,          // Unified disabled opacity
    pointerEvents: 'none' as const,
  },
  // CSS classes for consistent application
  cssClasses: {
    hoverBg: 'hover:bg-opacity-8',
    hoverBorder: 'hover:border-strong',
    pressedBg: 'active:bg-opacity-12',
  },
} as const;
