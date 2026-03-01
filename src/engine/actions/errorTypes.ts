/**
 * @file errorTypes.ts
 * @description Defines structured subcategories for Figma node execution failures.
 */

export enum ActionErrorSubCategory {
  LAYOUT_CONSTRAINT = 'LAYOUT_CONSTRAINT',
  SIZING_CONFLICT = 'SIZING_CONFLICT',
  NODE_TYPE_CONSTRAINT = 'NODE_TYPE_CONSTRAINT',
  PROPERTY_INVALID = 'PROPERTY_INVALID',
  FONT_UNLOADED = 'FONT_UNLOADED',
  PAINT_INVALID = 'PAINT_INVALID',
  EFFECT_INVALID = 'EFFECT_INVALID',
  INTERNAL_WASM = 'INTERNAL_WASM',
  UNKNOWN = 'UNKNOWN',
}

export interface ActionErrorContext {
  subCategory: ActionErrorSubCategory;
  rawMessage: string;
  failedNodeId?: string;
  retryTried: boolean;
  canRetryLocally: boolean;
}
