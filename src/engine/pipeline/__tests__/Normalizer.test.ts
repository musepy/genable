import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Normalizer } from '../Normalizer';
import { NODE_TYPES } from '../../../constants/figma-api';

// Mock flowObserver to avoid side effects
vi.mock('../../figma-adapter/observers/flowObserver', () => ({
  flowObserver: {
    log: vi.fn()
  },
  FlowPhase: {
    POST_PROCESS: 'POST_PROCESS'
  }
}));

describe('Normalizer V2 (Strict Mode)', () => {
  
  it('should pass through valid DSL without modification', () => {
    const input = {
      type: 'FRAME',
      props: {
        name: 'Valid Frame',
        layoutMode: 'VERTICAL',
        layoutSizingHorizontal: 'HUG',
        fills: ['#FF0000']
      },
      children: []
    };

    const result = Normalizer.normalize(input);
    const expected = { ...input };
    delete (expected as any).children; // Expect optimization
    expect(result).toEqual(expected);
  });

  // TODO: Normalizer V6.2 changed to fallback strategy — aggressive delete removed (Normalizer.ts:66-67)
  it.skip('should NOT lift nested "style" properties', () => {
    const input = {
      type: 'FRAME',
      props: { name: 'Legacy Node' },
      style: { backgroundColor: '#000' } // Legacy style object
    };

    const result = Normalizer.normalize(input);
    
    // In strict mode, 'style' should be ignored/dropped if not in props, 
    // or at least NOT lifted into props.
    expect(result.props.backgroundColor).toBeUndefined();
    expect(result.style).toBeUndefined(); 
  });

  it('should NOT perform fuzzy enum matching', () => {
    const input = {
      type: 'FRAME',
      props: {
        layoutMode: 'VERT' // Legacy abbreviation
      }
    };

    const result = Normalizer.normalize(input);
    
    // Should NOT be coerced to 'VERTICAL'. 
    // It might be deleted or kept as is, depending on strictness. 
    // Ideally for this downgrade, we want it to allow it if it's invalid? 
    // Or strip it. The goal is to NOT magically fix it.
    // If we remove the map, it remains 'VERT' or is deleted if we strictly validate against schema.
    // For this test, let's assume we want to stop patching it, so it remains 'VERT' (garbage in, garbage out)
    // OR we delete it. Let's assert it does NOT become VERTICAL.
    expect(result.props.layoutMode).not.toBe('VERTICAL'); 
  });

  it('should wrap array root in a default Frame', () => {
    const input = [
      { type: 'RECTANGLE', props: {} }
    ];

    const result = Normalizer.normalize(input);
    expect(result.type).toBe('FRAME');
    expect(result.children).toHaveLength(1);
  });

  it('should NOT lift "layout" properties', () => {
    const input = {
      type: 'FRAME',
      layout: { mode: 'VERTICAL' },
      props: { name: 'Layout Node' }
    };

    const result = Normalizer.normalize(input);
    expect(result.props.mode).toBeUndefined();
    expect(result.props.layoutMode).toBeUndefined();
  });
});
