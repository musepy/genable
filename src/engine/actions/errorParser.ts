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
    msg.includes('inconsistent layout') ||
    msg.includes('not in an auto-layout') ||
    msg.includes('auto-layout frame') ||
    msg.includes('layoutmode')
  ) {
    return ActionErrorSubCategory.LAYOUT_CONSTRAINT;
  }

  // 2. Sizing conflicts (HUG/FILL on wrong context)
  if (
    msg.includes('layoutsizingvertical') ||
    msg.includes('layoutsizinghorizontal') ||
    msg.includes('hug') ||
    msg.includes('sizing') ||
    msg.includes('fill container') ||
    msg.includes('cannot resize') ||
    msg.includes('fixed size')
  ) {
    return ActionErrorSubCategory.SIZING_CONFLICT;
  }

  // 3. Node type constraints (property not available on this node type)
  if (
    msg.includes('not a valid property') ||
    msg.includes('does not exist on') ||
    msg.includes('is not a') ||
    msg.includes('expected an instance') ||
    msg.includes('not supported on') ||
    msg.includes('only supported on') ||
    msg.includes('cannot apply') ||
    msg.includes('node type')
  ) {
    return ActionErrorSubCategory.NODE_TYPE_CONSTRAINT;
  }

  // 4. Font loading failures
  if (
    msg.includes('font') ||
    msg.includes('loadfontasync') ||
    msg.includes('font is not loaded')
  ) {
    return ActionErrorSubCategory.FONT_UNLOADED;
  }

  // 5. Invalid fills, strokes
  if (
    msg.includes('apply fills') ||
    msg.includes('apply strokes') ||
    msg.includes('invalid paint') ||
    msg.includes('expected paint') ||
    msg.includes('color')
  ) {
    return ActionErrorSubCategory.PAINT_INVALID;
  }

  // 6. Invalid effects (shadows, blurs)
  if (
    msg.includes('apply effects') ||
    msg.includes('shadow') ||
    msg.includes('blur') ||
    msg.includes('invalid effect') ||
    msg.includes('expected effect')
  ) {
    return ActionErrorSubCategory.EFFECT_INVALID;
  }

  // 7. Generic property value invalid
  if (
    msg.includes('invalid value') ||
    msg.includes('expected a number') ||
    msg.includes('expected a string') ||
    msg.includes('out of range') ||
    msg.includes('must be positive') ||
    msg.includes('must be non-negative') ||
    msg.includes('nan') ||
    msg.includes('undefined is not')
  ) {
    return ActionErrorSubCategory.PROPERTY_INVALID;
  }

  // 8. Internal Figma webassembly/C++ assertions
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
