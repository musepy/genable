import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RenderLifecycleManager } from '../../pipeline/RenderLifecycleManager';

// Mock Figma API
const mockPage = {
  type: 'PAGE',
  children: [],
  appendChild: vi.fn(),
};

const mockParent = {
  id: 'parent-123',
  type: 'FRAME',
  width: 800,
  height: 600,
  children: [],
  appendChild: vi.fn(),
  parent: mockPage,
};

global.figma = {
  currentPage: mockPage,
  getNodeByIdAsync: vi.fn().mockImplementation(async (id) => {
    if (id === 'parent-123') return mockParent;
    return null;
  }),
} as any;

describe('Layout Nesting Reproduction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses explicit parent and provides parent bounds for parent-space positioning', async () => {
    const explicitParent = await figma.getNodeByIdAsync('parent-123');
    const placement = RenderLifecycleManager.resolvePlacement(null, null, explicitParent as any);

    expect(placement.parent).toBe(mockParent);
    expect(placement.strategy).toBe('PARENT_CENTER');
    expect(placement.parentBounds).toEqual({ width: 800, height: 600 });
  });

  it('falls back to page + viewport strategy when no target and no explicit parent', () => {
    const placement = RenderLifecycleManager.resolvePlacement(null, null);

    expect(placement.parent).toBe(mockPage);
    expect(placement.strategy).toBe('VIEWPORT');
    expect(placement.parentBounds).toBeUndefined();
  });
});
