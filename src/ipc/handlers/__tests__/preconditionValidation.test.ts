import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock @create-figma-plugin/utilities before it loads and tries to access figma global
vi.mock('@create-figma-plugin/utilities', () => ({
  emit: vi.fn(),
  on: vi.fn(),
}));

// Mock figma global
vi.stubGlobal('figma', {
  getNodeByIdAsync: vi.fn(),
});

import { validatePreconditions } from '../toolCallHandler';

describe('validatePreconditions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fail if TEXT node is assigned a layoutMode', async () => {
    vi.mocked(figma.getNodeByIdAsync).mockResolvedValue({ type: 'TEXT' } as any);
    
    const result = await validatePreconditions('setNodeLayout', { nodeId: '1:1', layoutMode: 'HORIZONTAL' });
    
    expect(result.valid).toBe(false);
    expect(result.error).toContain('TEXT nodes do not support layoutMode');
  });

  it('should pass if TEXT node is assigned layoutMode NONE', async () => {
    vi.mocked(figma.getNodeByIdAsync).mockResolvedValue({ type: 'TEXT' } as any);
    
    const result = await validatePreconditions('setNodeLayout', { nodeId: '1:1', layoutMode: 'NONE' });
    
    expect(result.valid).toBe(true);
  });

  it('should fail if FILL sizing is used without auto-layout parent', async () => {
    vi.mocked(figma.getNodeByIdAsync).mockResolvedValue({ 
      type: 'FRAME', 
      parent: { type: 'FRAME', layoutMode: 'NONE' } 
    } as any);
    
    const result = await validatePreconditions('setNodeLayout', { 
      nodeId: '1:1', 
      sizing: { horizontal: 'FILL', vertical: 'FIXED' } 
    });
    
    expect(result.valid).toBe(false);
    expect(result.error).toContain("'FILL' sizing requires a parent with Auto Layout");
  });

  it('should pass if FILL sizing is used with auto-layout parent', async () => {
    vi.mocked(figma.getNodeByIdAsync).mockResolvedValue({ 
      type: 'FRAME', 
      parent: { type: 'FRAME', layoutMode: 'VERTICAL' } 
    } as any);
    
    const result = await validatePreconditions('setNodeLayout', { 
      nodeId: '1:1', 
      sizing: { horizontal: 'FILL', vertical: 'FIXED' } 
    });
    
    expect(result.valid).toBe(true);
  });
});
