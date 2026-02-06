import { describe, it, expect, beforeEach } from 'vitest';
import { patchCache } from '../patchCache';

describe('PatchCache', () => {
  beforeEach(() => {
    patchCache.clear();
  });

  it('should allow the first patch for a node', () => {
    const result = patchCache.shouldApply('node-1', 'styles', { fills: ['#FF0000'] });
    expect(result).toBe(true);
  });

  it('should skip duplicate patches for the same node', () => {
    patchCache.shouldApply('node-1', 'styles', { fills: ['#FF0000'] });
    const result = patchCache.shouldApply('node-1', 'styles', { fills: ['#FF0000'] });
    expect(result).toBe(false);
  });

  it('should skip duplicate patches even if keys are in different order', () => {
    patchCache.shouldApply('node-1', 'layout', { gap: 10, padding: 20 });
    const result = patchCache.shouldApply('node-1', 'layout', { padding: 20, gap: 10 });
    expect(result).toBe(false);
  });

  it('should allow different patch types for the same node', () => {
    patchCache.shouldApply('node-1', 'styles', { fills: ['#FF0000'] });
    const result = patchCache.shouldApply('node-1', 'layout', { gap: 10 });
    expect(result).toBe(true);
  });

  it('should allow changed data for the same node and type', () => {
    patchCache.shouldApply('node-1', 'styles', { fills: ['#FF0000'] });
    const result = patchCache.shouldApply('node-1', 'styles', { fills: ['#0000FF'] });
    expect(result).toBe(true);
  });

  it('should separate cache by nodeId', () => {
    patchCache.shouldApply('node-1', 'styles', { fills: ['#FF0000'] });
    const result = patchCache.shouldApply('node-2', 'styles', { fills: ['#FF0000'] });
    expect(result).toBe(true);
  });

  it('should allow re-application after invalidation', () => {
    patchCache.shouldApply('node-1', 'styles', { fills: ['#FF0000'] });
    patchCache.invalidate('node-1');
    const result = patchCache.shouldApply('node-1', 'styles', { fills: ['#FF0000'] });
    expect(result).toBe(true);
  });
});
