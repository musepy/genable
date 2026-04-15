import { PropertyHandler, Warning } from './types';
import { constraintsSpec } from '../../../domain/property-specs';

/**
 * Handler for `constraints` property — converts compact string format
 * (e.g., "MIN,CENTER") to Figma's { horizontal, vertical } object.
 *
 * Accepts:
 *   - String: "MIN,CENTER" or "STRETCH,SCALE"
 *   - Object: { horizontal: 'MIN', vertical: 'CENTER' } (pass-through)
 */
export const constraintsHandler: PropertyHandler = {
  name: 'constraints',

  match(key, _value, node) {
    return key === 'constraints' && 'constraints' in node;
  },

  async apply(node, _key, value): Promise<Warning[]> {
    try {
      let constraintObj: any;
      if (typeof value === 'string') {
        const parsed = constraintsSpec.parseXml(value);
        constraintObj = constraintsSpec.toFigma(parsed);
      } else if (typeof value === 'object' && value !== null) {
        constraintObj = value;
      } else {
        return [{ code: 'CONSTRAINTS_INVALID', severity: 'warning', message: `Invalid constraints value: ${value}` }];
      }
      (node as any).constraints = constraintObj;
      return [];
    } catch (e: any) {
      return [{ code: 'CONSTRAINTS_FAILED', severity: 'warning', message: `Failed to apply constraints: ${e?.message}` }];
    }
  },
};
