import { PropertyHandler, Warning } from './types';

/** Handles width/height — uses node.resize() instead of direct property assignment. */
export const resizeHandler: PropertyHandler = {
  name: 'resize',

  match(key, _value, node) {
    return (key === 'width' || key === 'height') && 'resize' in node;
  },

  async apply(node, key, value): Promise<Warning[]> {
    try {
      (node as any).resize(
        key === 'width' ? value : node.width,
        key === 'height' ? value : node.height,
      );
      return [];
    } catch (e: any) {
      return [{ code: 'RESIZE_FAILED', severity: 'warning', message: `Failed to resize: ${e.message}` }];
    }
  },
};
