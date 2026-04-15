import { PropertyHandler, Warning } from './types';
import { lowerUnitValue } from '../../figma/figma-lowering';

const UNIT_VALUE_KEYS = new Set(['letterSpacing', 'lineHeight']);

/** Handles letterSpacing and lineHeight — converts number/string/object to Figma unit values. */
export const unitValueHandler: PropertyHandler = {
  name: 'unitValue',

  match(key, value) {
    return UNIT_VALUE_KEYS.has(key) &&
      (typeof value === 'number' || typeof value === 'string' ||
       (typeof value === 'object' && value !== null && 'unit' in value));
  },

  async apply(node, key, value): Promise<Warning[]> {
    try {
      (node as any)[key] = lowerUnitValue(value);
      return [];
    } catch (e: any) {
      return [{ code: 'PROP_NORMALIZE_FAILED', severity: 'warning', message: `Failed to apply ${key}: ${e.message}` }];
    }
  },
};
