import { vi, describe, it, expect, beforeEach } from 'vitest';
import { findNodeByIdAsync } from '../../engine/pipeline/RenderOrchestrator';

// Mock figma global
vi.stubGlobal('figma', {
  getNodeByIdAsync: vi.fn(),
});

describe('RenderOrchestrator - Async Node Lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use getNodeByIdAsync for node lookups', async () => {
    const mockNode = { id: '1:1', type: 'FRAME', removed: false };
    (figma.getNodeByIdAsync as any).mockResolvedValue(mockNode);

    const result = await findNodeByIdAsync('1:1');

    expect(figma.getNodeByIdAsync).toHaveBeenCalledWith('1:1');
    expect(result).toBe(mockNode);
  });

  it('should return null and handle errors gracefully when node is not found', async () => {
    (figma.getNodeByIdAsync as any).mockResolvedValue(null);

    const result = await findNodeByIdAsync('999:999');

    expect(figma.getNodeByIdAsync).toHaveBeenCalledWith('999:999');
    expect(result).toBeNull();
  });

  it('should return null when figma.getNodeByIdAsync throws', async () => {
    (figma.getNodeByIdAsync as any).mockRejectedValue(new Error('Figma Error'));

    const result = await findNodeByIdAsync('1:1');

    expect(result).toBeNull();
  });
});
