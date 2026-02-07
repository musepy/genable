/**
 * @file layout.ts
 * @description Centralized layout constants to eliminate isolated hardcoding.
 */

export const WINDOW_WIDTH = 340;
export const WINDOW_HEIGHT_DEFAULT = 540; // Increased base height for better content fit

export const getIdealHeight = (editorType?: string) => {
  // We no longer squeeze dev mode to 400 by default as it clips too much content.
  // Instead, we use 540 as a healthy baseline.
  return WINDOW_HEIGHT_DEFAULT;
};
