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

  it('SHOULD NOT ignore explicit parentId (Current Bug Simulation)', async () => {
    // Current behavior: handleUnifiedRender doesn't pass parentId to resolvePlacement
    // It only passes targetNode for modification or streamRoot.
    
    // Simulate what main.ts does now:
    const targetNode = null; 
    const existingStreamRoot = null;
    
    const placement = RenderLifecycleManager.resolvePlacement(targetNode, existingStreamRoot);
    
    // BUG: It defaults to currentPage even if the LLM provided a parentId in parameters
    expect(placement.parent).toBe(mockPage);
  });

  it('SHOULD respect explicit parent if provided (Desired Fix)', async () => {
    // We want to add an explicitParent parameter to resolvePlacement
    const explicitParentId = 'parent-123';
    const explicitParent = await figma.getNodeByIdAsync(explicitParentId);
    
    // We will update resolvePlacement to handle this
    const placement = (RenderLifecycleManager as any).resolvePlacement(
      null, 
      null, 
      explicitParent // New parameter
    );
    
    expect(placement.parent).toBe(mockParent);
  });
});
