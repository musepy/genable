/**
 * @file errorParser.ts
 * @description Maps raw error strings from Figma into structured error subcategories
 * for targeted local auto-retry mechanisms.
 */

import { ActionErrorSubCategory } from './errorTypes';

export function parseActionError(errorStr: string): ActionErrorSubCategory {
  const msg = (errorStr || '').toLowerCase();

  // 1. Layout constraints & positioning
  if (
    msg.includes('layoutpositioning') ||
    msg.includes('layoutalign') ||
    msg.includes('constraints') ||
    msg.includes('must be set after') ||
    msg.includes('cannot set the layout') ||
    msg.includes('inconsistent layout')
  ) {
    return ActionErrorSubCategory.LAYOUT_CONSTRAINT;
  }

  // 2. Font loading failures
  if (
    msg.includes('font') ||
    msg.includes('loadfontasync') ||
    msg.includes('font is not loaded')
  ) {
    return ActionErrorSubCategory.FONT_UNLOADED;
  }

  // 3. Invalid fills, strokes
  if (
    msg.includes('apply fills') ||
    msg.includes('apply strokes') ||
    msg.includes('invalid paint') ||
    msg.includes('expected paint') ||
    msg.includes('color')
  ) {
    return ActionErrorSubCategory.PAINT_INVALID;
  }

  // 4. Invalid effects (shadows, blurs)
  if (
    msg.includes('apply effects') ||
    msg.includes('shadow') ||
    msg.includes('blur') ||
    msg.includes('invalid effect') ||
    msg.includes('expected effect')
  ) {
    return ActionErrorSubCategory.EFFECT_INVALID;
  }

  // 5. Internal Figma webassembly/C++ assertions
  if (
    msg.includes('wasm') ||
    msg.includes('internal error') ||
    msg.includes('assert') ||
    msg.includes('c++') ||
    msg.includes('figma.core')
  ) {
    return ActionErrorSubCategory.INTERNAL_WASM;
  }

  return ActionErrorSubCategory.UNKNOWN;
}
