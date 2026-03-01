import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionExecutor } from '../executor';
import { FigmaAction } from '../types';

// Mock Figma API
const createMockNode = (type: string, id: string) => {
  const children: any[] = [];
  const node = {
    id,
    type,
    name: 'Node',
    children,
    removed: false,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    fontName: null,
    characters: '',
    appendChild: vi.fn((child: any) => children.push(child)),
    insertChild: vi.fn((index: number, child: any) => children.splice(index, 0, child)),
    remove: vi.fn(function(this: any) { this.removed = true; })
  };

  // Simulate a getter-only property that exists on real Figma nodes.
  Object.defineProperty(node, 'readonlyMetric', {
    get() {
      return 0;
    },
    enumerable: true,
    configurable: true
  });

  return node;
};

describe('ActionExecutor', () => {
  beforeEach(() => {
    // Basic Figma globals mocking
    let idCounter = 1;
    const nodes = new Map<string, any>();
    
    (global as any).figma = {
      createFrame: vi.fn(() => {
        const n = createMockNode('FRAME', `node-${idCounter++}`);
        nodes.set(n.id, n);
        return n;
      }),
      createText: vi.fn(() => {
        const n = createMockNode('TEXT', `node-${idCounter++}`);
        nodes.set(n.id, n);
        return n;
      }),
      createRectangle: vi.fn(() => {
         const n = createMockNode('RECTANGLE', `node-${idCounter++}`);
         nodes.set(n.id, n);
         return n;
      }),
      createVector: vi.fn(() => {
         const n = createMockNode('VECTOR', `node-${idCounter++}`);
         nodes.set(n.id, n);
         return n;
      }),
      createNodeFromSvg: vi.fn(() => {
         const n = createMockNode('FRAME', `node-${idCounter++}`);
         nodes.set(n.id, n);
         return n;
      }),
      getNodeById: vi.fn((id: string) => nodes.get(id) || null),
      getNodeByIdAsync: vi.fn(async (id: string) => nodes.get(id) || null),
      loadFontAsync: vi.fn(async () => {}),
      importComponentByKeyAsync: vi.fn(async () => null),
      util: {
        solidPaint: vi.fn((color: string) => ({ type: 'SOLID', color }))
      }
    };
  });

  it('creates nodes sequentially and resolves tempIds', async () => {
    const executor = new ActionExecutor();
    const actions: FigmaAction[] = [
      { action: 'createFrame', tempId: 'parentFrame', props: { name: 'Root' } },
      { action: 'createText', tempId: 'child', parentId: 'parentFrame', props: { characters: 'Hello' } }
    ];

    const result = await executor.execute(actions);
    expect(result.success).toBe(true);
    expect(result.idMap['parentFrame']).toBeDefined();
    expect(result.idMap['child']).toBeDefined();
    
    // Verify parentId was correctly resolved: root child array should have length 1
    const rootNode = figma.getNodeById(result.idMap['parentFrame']);
    expect((rootNode as any).children).toHaveLength(1);
  });

  it('sorts actions topologically based on dependsOn', async () => {
    const executor = new ActionExecutor();
    // provided out of order
    const actions: FigmaAction[] = [
      { action: 'createText', tempId: 'child', parentId: 'parentFrame', dependsOn: ['parentFrame'], props: { characters: 'Hello' } },
      { action: 'createFrame', tempId: 'parentFrame', props: { name: 'Root' } }
    ];

    const result = await executor.execute(actions);
    expect(result.success).toBe(true);
    // Since it's topologically sorted, 'parentFrame' runs first.
    const rootNode = figma.getNodeById(result.idMap['parentFrame']);
    expect((rootNode as any).children).toHaveLength(1);
    expect((rootNode as any).children[0].id).toBe(result.idMap['child']);
  });

  it('skips dependents when a dependency fails (skip-dependents)', async () => {
    const executor = new ActionExecutor({ onError: 'skip-dependents' });
    const actions: FigmaAction[] = [
      { action: 'delete', tempId: 'dep1', nodeId: 'nonexistent-id' }, // will fail
      { action: 'createFrame', tempId: 'dep2', dependsOn: ['dep1'], props: {} }, // should skip
      { action: 'createFrame', tempId: 'dep3', props: {} } // should run (independent)
    ];

    const result = await executor.execute(actions);
    expect(result.success).toBe(false); // overall batch failed
    expect(result.results[0].success).toBe(false); // delete failed
    expect(result.results[1].skipped).toBe(true); // dep2 skipped
    expect(result.results[2].success).toBe(true); // dep3 succeeded
  });

  it('does NOT roll back successfully created nodes when batch fails in skip-dependents mode', async () => {
    const executor = new ActionExecutor({ onError: 'skip-dependents' });
    const actions: FigmaAction[] = [
      { action: 'createFrame', tempId: 'node1', props: {} }, // success
      { action: 'delete', tempId: 'node2', nodeId: 'bad-id' } // fail
    ];

    const result = await executor.execute(actions);
    expect(result.success).toBe(false);
    expect(result.rollback.attempted).toBe(0); // since it's skip-dependents
    expect(result.rollback.removed).toBe(0);

    const createdNode = figma.getNodeById(result.idMap['node1']);
    expect((createdNode as any).removed).toBe(false); // Retained
  });

  it('rolls back successfully created nodes when batch fails in abort mode', async () => {
    const executor = new ActionExecutor({ onError: 'abort' });
    const actions: FigmaAction[] = [
      { action: 'createFrame', tempId: 'node1', props: {} }, // success
      { action: 'delete', tempId: 'node2', nodeId: 'bad-id' } // fail
    ];

    const result = await executor.execute(actions);
    expect(result.success).toBe(false);
    expect(result.rollback.attempted).toBe(1); // since it's abort
    expect(result.rollback.removed).toBe(1);

    const createdNode = figma.getNodeById(result.idMap['node1']);
    expect((createdNode as any).removed).toBe(true);
  });

  it('expands padding and handles convenient props', async () => {
    const executor = new ActionExecutor();
    const actions: FigmaAction[] = [
      { action: 'createFrame', tempId: 'f1', props: { padding: 16 } }
    ];

    const result = await executor.execute(actions);
    expect(result.success).toBe(true);
    
    const node: any = figma.getNodeById(result.idMap['f1']);
    expect(node.paddingTop).toBe(16);
    expect(node.paddingLeft).toBe(16);
    expect(node.paddingBottom).toBe(16);
    expect(node.paddingRight).toBe(16);
  });

  it('skips getter-only properties instead of failing the entire action', async () => {
    const executor = new ActionExecutor();
    const actions: FigmaAction[] = [
      { action: 'createFrame', tempId: 'f1', props: { name: 'Safe', readonlyMetric: 123 } }
    ];

    const result = await executor.execute(actions);
    expect(result.success).toBe(true);
    expect(result.results[0].success).toBe(true);

    const node: any = figma.getNodeById(result.idMap['f1']);
    expect(node.name).toBe('Safe');
    expect(node.readonlyMetric).toBe(0);
  });

  it('collects FONT_FALLBACK warnings when fonts cannot be loaded exactly as requested', async () => {
    const executor = new ActionExecutor();
    const fontBusModule = await import('../../figma-adapter/resources/FontBus');
    const getOrLoadSpy = vi.spyOn(fontBusModule.fontBus, 'getOrLoad').mockResolvedValue({
        success: false,
        loadedStyle: 'Regular'
    });

    const actions: FigmaAction[] = [
      { 
          action: 'createText', 
          tempId: 't1', 
          props: { characters: 'Test', fontWeight: 'Semi Bold' } 
      }
    ];

    const result = await executor.execute(actions);
    
    // Verify success is still true on fallback
    expect(result.success).toBe(true);
    expect(result.results[0].success).toBe(true);
    
    // Verify warnings were collected
    const warnings = result.results[0].warnings;
    expect(warnings).toBeDefined();
    expect(warnings?.length).toBeGreaterThan(0);
    expect(warnings?.[0].code).toBe('FONT_FALLBACK');
    expect(warnings?.[0].message).toContain('applied fallback: Regular');
    
    getOrLoadSpy.mockRestore();
  });

  it('creates VECTOR nodes via figma.createVector()', async () => {
    const executor = new ActionExecutor();
    const actions: FigmaAction[] = [
      { action: 'createShape', tempId: 'v1', shapeType: 'VECTOR', props: { width: 24, height: 24 } }
    ];

    const result = await executor.execute(actions);
    expect(result.success).toBe(true);
    expect(figma.createVector).toHaveBeenCalledTimes(1);

    const node: any = figma.getNodeById(result.idMap['v1']);
    expect(node.type).toBe('VECTOR');
  });

  it('validates non-tempId dependencies via figma.getNodeByIdAsync', async () => {
    const executor = new ActionExecutor();
    const actions: FigmaAction[] = [
       { action: 'createFrame', tempId: 'f1', dependsOn: ['realFigmaId'], props: {} }
    ];

    const result = await executor.execute(actions);
    // Overall success might be true if it just skips, but we check the specific action result
    expect(result.results[0].success).toBe(false);
    expect(figma.getNodeByIdAsync).toHaveBeenCalledWith('realFigmaId');
    expect(result.results[0].error).toContain('Dependency \'realFigmaId\' failed');
  });

  it('cleans up orphan nodes when applyProps fails during creation', async () => {
    const executor = new ActionExecutor();
    const applyPropsSpy = vi.spyOn(executor as any, 'applyProps').mockImplementation(async (node: any, props: any) => {
       if (props.triggerError) throw new Error('Simulated property error');
       return [];
    });

    const actions: FigmaAction[] = [
      { action: 'createFrame', tempId: 'f1', props: { triggerError: true } }
    ];

    const result = await executor.execute(actions);
    expect(result.success).toBe(false);
    
    // createFrame should have been called, returning a mock node
    const createFrameMock = figma.createFrame as any;
    const lastCreatedNode = createFrameMock.mock.results[createFrameMock.mock.results.length - 1].value;
    
    // The node should have been removed to prevent orphan leaks
    expect(lastCreatedNode.removed).toBe(true);
    
    applyPropsSpy.mockRestore();
  });

  it('provides rich error structure on failure', async () => {
    const executor = new ActionExecutor();
    const actions: FigmaAction[] = [
      { action: 'createFrame', tempId: 'f1', props: { triggerError: true } }
    ];

    const applyPropsSpy = vi.spyOn(executor as any, 'applyProps').mockImplementation(async (node: any, props: any) => {
       if (props.triggerError) throw new Error('Simulated format error');
       return [];
    });
    
    const result = await executor.execute(actions);
    expect(result.success).toBe(false);
    
    const failedResult = result.results[0] as any;
    expect(failedResult.success).toBe(false);
    expect(failedResult.errorContext).toBeDefined();
    expect(failedResult.errorContext.subCategory).toBeDefined();
    expect(failedResult.errorContext.retryTried).toBeDefined();
    expect(failedResult.errorContext.failedNodeId).toBe('f1');
    
    applyPropsSpy.mockRestore();
  });
});
