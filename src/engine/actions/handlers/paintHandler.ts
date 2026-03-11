import { PropertyHandler, Warning } from './types';
import { lowerPaints } from '../../figma/figma-lowering';

/** Handles fills and strokes — converts LLM-friendly paint arrays to Figma Paint objects. */
export const paintHandler: PropertyHandler = {
  name: 'paint',

  match(key) {
    return (key === 'fills' || key === 'strokes') ;
  },

  async apply(node, key, value): Promise<Warning[]> {
    if (!Array.isArray(value)) return [];
    try {
      (node as any)[key] = lowerPaints(value);
      return [];
    } catch (e: any) {
      return [{ code: 'PAINT_INVALID', severity: 'warning', message: `Failed to apply ${key}: ${e.message}` }];
    }
  },
};
