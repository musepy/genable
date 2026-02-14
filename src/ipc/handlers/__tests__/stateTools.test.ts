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

vi.mock('../../../engine/agent/planState', () => ({
  planState: {
    completeTask: vi.fn(),
    setCurrentPlan: vi.fn()
  }
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

    describe('renderSubtree', () => {
        it('should render a complete subtree from flat list', async () => {
            const mockNode = { id: 'root:1', name: 'Root', type: 'FRAME' };
            (handleUnifiedRender as any).mockResolvedValue(mockNode);

            const nodes = [
                { id: 'root', parent: null, type: 'FRAME', props: { name: 'Root', fills: ['#FFFFFF'] } },
                { id: 'child1', parent: 'root', type: 'TEXT', props: { name: 'label', characters: 'Hello' } }
            ];

            const parameters = {
                nodes,
                parentId: 'parent-123'
            };

            await handleToolCall({
                toolName: 'renderSubtree',
                parameters,
                requestId: 'req-1'
            });

            expect(handleUnifiedRender).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'FRAME',
                    props: expect.objectContaining({ name: 'Root' }),
                    children: expect.arrayContaining([
                        expect.objectContaining({ type: 'TEXT', props: expect.objectContaining({ characters: 'Hello' }) })
                    ])
                }),
                false,
                'parent-123'
            );

            expect(emit).toHaveBeenCalledWith('TOOL_RESULT', expect.objectContaining({
                requestId: 'req-1',
                response: expect.objectContaining({
                    success: true,
                    data: expect.objectContaining({ nodeId: 'root:1' })
                })
            }));
        });

        it('should fail if nodes array is empty', async () => {
            const parameters = {
                nodes: []
            };

            await handleToolCall({
                toolName: 'renderSubtree',
                parameters,
                requestId: 'req-2'
            });

            expect(handleUnifiedRender).not.toHaveBeenCalled();
            expect(emit).toHaveBeenCalledWith('TOOL_RESULT', expect.objectContaining({
                response: expect.objectContaining({
                    success: false,
                    error: expect.objectContaining({ code: 'INVALID_INPUT' })
                })
            }));
        });
    });

    describe('patchNode', () => {
        it('should merge props into current state', async () => {
            const nodeId = '2:2';
            const mockNode = { 
                id: nodeId, 
                name: 'Button', 
                type: 'FRAME',
                parent: { id: 'parent-456' }
            };
            (mockFigma.getNodeByIdAsync as any).mockResolvedValue(mockNode);
            (handleUnifiedRender as any).mockResolvedValue(mockNode);
            (NodeSerializer.serialize as any).mockReturnValue({
                id: nodeId,
                type: 'FRAME',
                props: { name: 'Button', fills: ['#000000'] }
            });

            const parameters = {
                nodeId,
                props: { fills: ['#FF0000'], padding: 12 }
            };

            await handleToolCall({
                toolName: 'patchNode',
                parameters,
                requestId: 'req-3'
            });

            expect(handleUnifiedRender).toHaveBeenCalledWith(
                expect.objectContaining({
                    __modifyMode: 'UPDATE',
                    __modifyTargetId: nodeId,
                    props: expect.objectContaining({
                        fills: ['#FF0000'],
                        padding: 12,
                        name: 'Button'
                    })
                }),
                false,
                mockNode.parent
            );

            expect(emit).toHaveBeenCalledWith('TOOL_RESULT', expect.objectContaining({
                requestId: 'req-3',
                response: expect.objectContaining({ success: true })
            }));
        });

        it('should deep merge nested objects like constraints', async () => {
            const nodeId = 'deep-1';
            const mockNode = { id: nodeId, name: 'Frame', type: 'FRAME', parent: null };
            (mockFigma.getNodeByIdAsync as any).mockResolvedValue(mockNode);
            (handleUnifiedRender as any).mockResolvedValue(mockNode);
            (NodeSerializer.serialize as any).mockReturnValue({
                id: nodeId,
                type: 'FRAME',
                props: { 
                    name: 'Frame', 
                    constraints: { horizontal: 'MIN', vertical: 'MIN' } 
                }
            });

            await handleToolCall({
                toolName: 'patchNode',
                parameters: {
                    nodeId,
                    props: { constraints: { horizontal: 'CENTER' } }
                },
                requestId: 'req-deep'
            });

            expect(handleUnifiedRender).toHaveBeenCalledWith(
                expect.objectContaining({
                    props: expect.objectContaining({
                        constraints: { horizontal: 'CENTER', vertical: 'MIN' } // Deep merge preserved vertical
                    })
                }),
                false,
                null
            );
        });
    });

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
