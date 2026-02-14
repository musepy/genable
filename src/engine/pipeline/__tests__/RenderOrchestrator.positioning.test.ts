import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../figma-adapter/renderers', () => ({
  renderNodeDSL: vi.fn(),
  initializeRenderers: vi.fn()
}));

vi.mock('../Normalizer', () => ({
  Normalizer: {
    normalize: vi.fn((input) => input)
  }
}));

vi.mock('../../figma-adapter/caches/figmaVariableCache', () => ({
  figmaVariableCache: {
    warmup: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../../figma-adapter/resources/FontBus', () => ({
  fontBus: {
    warmup: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../../figma-adapter/observers/flowObserver', () => ({
  flowObserver: {
    startTrace: vi.fn()
  },
  FlowPhase: {}
}));

import { renderNodeDSL } from '../../figma-adapter/renderers';
import { RenderOrchestrator } from '../RenderOrchestrator';

describe('RenderOrchestrator positioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).figma = {
      currentPage: { type: 'PAGE' },
      getNodeByIdAsync: vi.fn().mockResolvedValue(null)
    };
  });

  it('fails fast when PARENT_CENTER is requested without parent bounds', async () => {
    const rootNode = { x: 0, y: 0, width: 120, height: 60 };
    (renderNodeDSL as any).mockResolvedValue(rootNode);

    const orchestrator = new RenderOrchestrator();
    await expect(
      orchestrator.process({
        layerData: { id: 'n1', type: 'FRAME', props: { name: 'test' } } as any,
        designSystemId: 'vanilla',
        designSystemConfig: {} as any,
        meta: {
          parent: { type: 'FRAME' } as any,
          positionStrategy: 'PARENT_CENTER',
          viewportCenter: { x: 99999, y: 88888 }
        }
      })
    ).rejects.toThrow('Missing parentBounds for PARENT_CENTER strategy');
  });

  it('centers in parent space when parent bounds exist', async () => {
    const rootNode = { x: 0, y: 0, width: 200, height: 100 };
    (renderNodeDSL as any).mockResolvedValue(rootNode);

    const orchestrator = new RenderOrchestrator();
    const result = await orchestrator.process({
      layerData: { id: 'n2', type: 'FRAME', props: { name: 'test' } } as any,
      designSystemId: 'vanilla',
      designSystemConfig: {} as any,
      meta: {
        parent: { type: 'FRAME' } as any,
        positionStrategy: 'PARENT_CENTER',
        parentBounds: { width: 800, height: 600 }
      }
    });

    expect(result).toBe(rootNode);
    expect((result as any).x).toBe(300);
    expect((result as any).y).toBe(250);
  });
});
