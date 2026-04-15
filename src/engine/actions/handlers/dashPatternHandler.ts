import { PropertyHandler, Warning } from './types';

/**
 * Handler for `dashPattern` — converts compact string "10,5" to number[].
 *
 * Accepts:
 *   - String: "10,5" or "10 5" (comma or space separated)
 *   - Array: [10, 5] (pass-through)
 */
export const dashPatternHandler: PropertyHandler = {
  name: 'dashPattern',

  match(key, _value, node) {
    return key === 'dashPattern' && 'dashPattern' in node;
  },

  async apply(node, _key, value): Promise<Warning[]> {
    try {
      let pattern: number[];
      if (typeof value === 'string') {
        pattern = value.split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
      } else if (Array.isArray(value)) {
        pattern = value.map(Number).filter(n => !isNaN(n));
      } else {
        return [{ code: 'DASH_INVALID', severity: 'warning', message: `Invalid dashPattern value: ${value}` }];
      }
      (node as any).dashPattern = pattern;
      return [];
    } catch (e: any) {
      return [{ code: 'DASH_FAILED', severity: 'warning', message: `Failed to apply dashPattern: ${e?.message}` }];
    }
  },
};
