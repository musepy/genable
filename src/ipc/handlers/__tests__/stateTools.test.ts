import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToolCall } from '../toolCallHandler';
import { nodeLayoutService } from '../../../engine/services';
import { handleUnifiedRender } from '../../helpers/renderHelper';
import { emit } from '@create-figma-plugin/utilities';
import { NodeSerializer } from '../../../engine/figma-adapter/nodeSerializer';
import { ActionExecutor } from '../../../engine/actions/executor';

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

// Setup an observable mock implementation at module level
const { mockActionExecutorExecute } = vi.hoisted(() => ({
  mockActionExecutorExecute: vi.fn().mockResolvedValue({
    success: true,
    results: [],
    idMap: {},
    rollback: undefined
  })
}));

export { mockActionExecutorExecute };

vi.mock('../../../engine/actions/executor', () => ({
  ActionExecutor: class {
    execute = mockActionExecutorExecute;
  }
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
            mockActionExecutorExecute.mockResolvedValueOnce({
                success: true,
                results: [
                    { action: { action: 'renderSubtree', tempId: 'op1' }, success: true, nodeId: '10:1' }
                ],
                idMap: { 'op1': '10:1' },
                rollback: undefined
            });

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

            expect(mockActionExecutorExecute).toHaveBeenCalled();
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
            mockActionExecutorExecute.mockResolvedValueOnce({
                success: true,
                results: [
                    { action: { action: 'patchNode', tempId: 'op2' }, success: true, nodeId: nodeId }
                ],
                idMap: { 'op2': nodeId },
                rollback: undefined
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

            expect(mockActionExecutorExecute).toHaveBeenCalled();
            expect(emit).toHaveBeenCalledWith('TOOL_RESULT', expect.objectContaining({
                response: expect.objectContaining({ success: true })
            }));
        });
    });
});
