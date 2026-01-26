/**
 * @file defaults.ts
 * @description Centralized magic numbers and system defaults.
 */

export const VIEWPORT_DEFAULTS = {
  DESKTOP: { width: 1440, height: 1024 },
  MOBILE: { width: 390, height: 844 },
  MOBILE_BREAKPOINT: 480
};

export const STREAM_CONFIG = {
  BATCH_SIZE: 5,
  RENDER_INTERVAL_MS: 800,
  THINKING_BEAT_MS: 100 // Flowing rhythm for thinking text
};

export const UI_DEFAULTS = {
  LOADING_STEPS: [
    'Understanding design intent...',
    'Architecting component structure...',
    'Applying visual styles...',
    'Refining layout constraints...',
    'Generating Figma layers...'
  ]
};
