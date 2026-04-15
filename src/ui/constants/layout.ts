/**
 * @file layout.ts
 * @description Centralized layout constants to eliminate isolated hardcoding.
 */

export const WINDOW_WIDTH = 360;
export const WINDOW_HEIGHT_DEFAULT = 640;

export const getIdealHeight = (editorType?: string) => {
  return WINDOW_HEIGHT_DEFAULT;
};
