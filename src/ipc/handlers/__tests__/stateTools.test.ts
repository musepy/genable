import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToolCall } from '../toolCallHandler';
import { nodeLayoutService } from '../../../engine/services';
import { handleUnifiedRender } from '../../helpers/renderHelper';
import { emit } from '@create-figma-plugin/utilities';
import { NodeSerializer } from '../../../engine/figma-adapter/nodeSerializer';

// Mock dependencies
vi.mock('@create-figma-plugin/utilities', () => ({
  emit: vi.fn(),
  on: vi.fn(),
}));

vi.mock('../../../engine/services', () => ({
  nodeLayoutService: {
    applyLayout: vi.fn(),
    applyStyles: vi.fn(),
    deleteNode: vi.fn(),
    resolveParent: vi.fn(),
  },
}));

vi.mock('../../helpers/renderHelper', () => ({
  handleUnifiedRender: vi.fn(),
}));

vi.mock('../../../engine/figma-adapter/nodeSerializer', () => ({
  NodeSerializer: {
    serialize: vi.fn((node) => ({ id: node.id, name: node.name, type: node.type, props: { name: node.name } })),
  },
}));



vi.mock('../../../engine/validation/patchCache', () => ({
  patchCache: {
    shouldApply: vi.fn(() => true),
    invalidate: vi.fn(),
  }
}));

vi.mock('../../../engine/validation/visibilityValidator', () => ({
  validateVisibility: vi.fn(() => ({ valid: true, issues: [], autoFixed: [] })),
}));

// Mock Figma Global
const mockFigma = {
    getNodeByIdAsync: vi.fn(),
};
(global as any).figma = mockFigma;

describe('State-Driven Tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (nodeLayoutService.resolveParent as any).mockImplementation(async (id: string) => id || null);
    });

    // NOTE: Direct renderSubtree and patchNode routes were removed from toolCallHandler.ts
    // (replaced by unified tools: create_node, patch_node). These actions still work
    // as batch operations via executeBatchAction — see tests below.

    describe('batchOperations support', () => {
        it('should support renderSubtree in batch', async () => {
            const mockNode = { id: '10:1', name: 'BatchNode', type: 'FRAME' };
            (handleUnifiedRender as any).mockResolvedValue(mockNode);

            await handleToolCall({
                toolName: 'batchOperations',
                parameters: {
                    operations: [
                        {
                            opId: 'op1',
                            action: 'renderSubtree',
                            params: {
                                nodes: [{ id: 'root', type: 'FRAME', props: { name: 'BatchNode' } }]
                            }
                        }
                    ]
                },
                requestId: 'req-batch-1'
            });

            expect(handleUnifiedRender).toHaveBeenCalled();
            expect(emit).toHaveBeenCalledWith('TOOL_RESULT', expect.objectContaining({
                response: expect.objectContaining({
                    success: true,
                    data: expect.objectContaining({
                        results: [expect.objectContaining({ nodeId: '10:1' })]
                    })
                })
            }));
        });

        it('should support patchNode in batch', async () => {
            const nodeId = '20:1';
            const mockNode = { id: nodeId, name: 'Target', type: 'FRAME', parent: null };
            (mockFigma.getNodeByIdAsync as any).mockResolvedValue(mockNode);
            (handleUnifiedRender as any).mockResolvedValue(mockNode);
            (NodeSerializer.serialize as any).mockReturnValue({
                id: nodeId,
                type: 'FRAME',
                props: { name: 'Target' }
            });

            await handleToolCall({
                toolName: 'batchOperations',
                parameters: {
                    operations: [
                        {
                            opId: 'op2',
                            action: 'patchNode',
                            params: {
                                nodeId,
                                props: { visible: false }
                            }
                        }
                    ]
                },
                requestId: 'req-batch-2'
            });

            expect(handleUnifiedRender).toHaveBeenCalled();
            expect(emit).toHaveBeenCalledWith('TOOL_RESULT', expect.objectContaining({
                response: expect.objectContaining({ success: true })
            }));
        });
    });
});
