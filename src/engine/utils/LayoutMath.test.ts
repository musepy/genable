import { describe, expect, it } from 'vitest';
import { LayoutMath } from './LayoutMath';

describe('LayoutMath.resolveRootPosition', () => {
  it('centers inside parent bounds when strategy is PARENT_CENTER', () => {
    const pos = LayoutMath.resolveRootPosition('PARENT_CENTER', {
      parentBounds: { width: 800, height: 600 },
      nodeDimensions: { width: 200, height: 100 }
    });

    expect(pos).toEqual({ x: 300, y: 250 });
  });

  it('does not fallback to viewport for PARENT_CENTER without parent bounds', () => {
    const pos = LayoutMath.resolveRootPosition('PARENT_CENTER', {
      viewportCenter: { x: 100000, y: 50000 },
      manualPosition: { x: 12, y: 34 },
      nodeDimensions: { width: 200, height: 100 }
    });

    expect(pos).toEqual({ x: 12, y: 34 });
  });

  it('uses viewport center for VIEWPORT strategy', () => {
    const pos = LayoutMath.resolveRootPosition('VIEWPORT', {
      viewportCenter: { x: 100, y: 50 },
      nodeDimensions: { width: 20, height: 10 }
    });

    expect(pos).toEqual({ x: 90, y: 45 });
  });
});
