import { PropertyHandler, Warning } from './types';
import { lowerEffects } from '../../figma/figma-lowering';

/** Handles effects (shadows, blurs) — converts to Figma Effect objects. */
export const effectHandler: PropertyHandler = {
  name: 'effect',

  match(key) {
    return key === 'effects';
  },

  async apply(node, key, value): Promise<Warning[]> {
    if (!Array.isArray(value)) return [];
    try {
      (node as any).effects = lowerEffects(value);
      return [];
    } catch (e: any) {
      return [{ code: 'EFFECT_INVALID', severity: 'warning', message: `Failed to apply effects: ${e.message}` }];
    }
  },
};
