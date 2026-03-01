import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToolCall } from '../toolCallHandler';
import { nodeLayoutService } from '../../../engine/services';
import { handleUnifiedRender } from '../../helpers/renderHelper';
import { emit } from '@create-figma-plugin/utilities';

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

vi.mock('../../../engine/serialization/NodeSerializer', () => ({
  NodeSerializer: {
    serialize: vi.fn((node) => ({ id: node.id, name: node.name, type: node.type })),
  },
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


// Mock Figma Global
const mockFigma = {
    getNodeByIdAsync: vi.fn(),
};
(global as any).figma = mockFigma;

describe('batchOperations - Hierarchical Transactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Return the input ID as the "node" for simplicity in test
        (nodeLayoutService.resolveParent as any).mockImplementation(async (id: string) => id || null);
        
        // Mock getNodeByIdAsync to return a basic node object
        (mockFigma.getNodeByIdAsync as any).mockImplementation(async (id: string) => ({
            id,
            name: 'Mock Node',
            type: 'FRAME'
        }));
    });

    it('should create deeply nested structures using virtual IDs (opId)', async () => {
        // Setup: ActionExecutor mock for success
        const parentNodeId = '100:1';
        const childNodeId = '100:2';
        mockActionExecutorExecute.mockResolvedValueOnce({
            success: true,
            results: [
                { action: { action: 'createFrame', tempId: 'parent-frame' }, success: true, nodeId: parentNodeId },
                { action: { action: 'createFrame', tempId: 'child-frame' }, success: true, nodeId: childNodeId }
            ],
            idMap: { 'parent-frame': parentNodeId, 'child-frame': childNodeId },
            rollback: undefined
        });

        const batchParams = {
            operations: [
                {
                    opId: 'parent-frame',
                    action: 'createNode',
                    params: {
                        type: 'FRAME',
                        name: 'Parent Container',
                        children: [
                            {
                                opId: 'child-frame',
                                action: 'createNode',
                                params: {
                                    type: 'FRAME',
                                    name: 'Child Content'
                                }
                            }
                        ]
                    }
                }
            ]
        };

        // Execution
        await handleToolCall({
            toolName: 'batchOperations',
            parameters: batchParams,
            requestId: 'test-req-1'
        });

        // Verification: ActionExecutor should be called with translated actions
        expect(mockActionExecutorExecute).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ action: 'createFrame', tempId: 'parent-frame' }),
            expect.objectContaining({ action: 'createFrame', tempId: 'child-frame' })
        ]));

        // Verification: handleToolResult was emitted with success and snapshots
        expect(emit).toHaveBeenCalledWith('TOOL_RESULT', expect.objectContaining({
            requestId: 'test-req-1',
            response: expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    results: expect.arrayContaining([
                        expect.objectContaining({ opId: 'parent-frame', nodeId: parentNodeId }),
                        expect.objectContaining({ opId: 'child-frame', nodeId: childNodeId })
                    ]),
                    layoutSnapshots: {}
                })
            })
        }));
    });

    it('should resolve virtual IDs (opId) across siblings', async () => {
        // Setup mocks
        const parentId = '100:1';
        const sibling1Id = '100:2';
        
        mockActionExecutorExecute.mockResolvedValueOnce({
            success: true,
            results: [
                { action: { action: 'createFrame', tempId: 'container' }, success: true, nodeId: parentId },
                { action: { action: 'createFrame', tempId: 'item1' }, success: true, nodeId: sibling1Id },
                { action: { action: 'updateProps', tempId: 'style-item1' }, success: true, nodeId: sibling1Id }
            ],
            idMap: { 'container': parentId, 'item1': sibling1Id },
            rollback: undefined
        });

        // Batch: Create parent, Create child1 inside parent, then set sibling1 styles using opId
        const batchParams = {
            operations: [
                {
                    opId: 'container',
                    action: 'createNode',
                    params: { type: 'FRAME' }
                },
                {
                    opId: 'item1',
                    action: 'createNode',
                    params: { type: 'FRAME', parentRef: 'container' }
                },
                {
                    opId: 'style-item1',
                    action: 'setNodeStyles',
                    params: { nodeRef: 'item1', fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }] }
                }
            ]
        };

        // Execution
        await handleToolCall({
            toolName: 'batchOperations',
            parameters: batchParams,
            requestId: 'test-req-2'
        });

        // Verification: ActionExecutor called with proper translations
        expect(mockActionExecutorExecute).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ action: 'createFrame', tempId: 'container' }),
            expect.objectContaining({ action: 'createFrame', tempId: 'item1', parentId: 'container' }),
            expect.objectContaining({ action: 'updateProps', nodeId: 'item1' }) // nodeRef translates to nodeId placeholder
        ]));
    });

    it('fails when underlying operation fails', async () => {
        mockActionExecutorExecute.mockResolvedValueOnce({
            success: false,
            results: [
                { action: { action: 'createFrame', tempId: 'child' }, success: false, error: 'Parent not found' }
            ],
            idMap: {},
            rollback: undefined
        });

        await handleToolCall({
            toolName: 'batchOperations',
            parameters: {
                operations: [
                    {
                        opId: 'child',
                        action: 'createNode',
                        params: {
                            type: 'FRAME',
                            name: 'Child',
                            parentId: 'missing-parent'
                        }
                    }
                ]
            },
            requestId: 'test-req-parent-missing'
        });

        const toolResultCall = (emit as any).mock.calls.find((call: any[]) => call[0] === 'TOOL_RESULT');
        const payload = toolResultCall?.[1];
        
        expect(payload.response.success).toBe(false);
        // Under SHADOW_RUN_TYPED_ACTIONS, failure payload returns execResult verbatim via BatchOpResult mapping.
        const failureResult = payload.response.data.results.find((r: any) => !r.success);
        expect(failureResult.error.code).toBe('EXECUTION_ERROR');
        expect(failureResult.error.message).toBe('Parent not found');
    });

    it('rolls back created nodes when batch has partial failure', async () => {
        const createdNodeId = '100:9';
        
        mockActionExecutorExecute.mockResolvedValueOnce({
            success: false,
            results: [
                { action: { action: 'createFrame', tempId: 'create-ok' }, success: true, nodeId: createdNodeId },
                { action: { action: 'updateProps', tempId: 'bad-op' }, success: false, error: 'forced failure' }
            ],
            idMap: { 'create-ok': createdNodeId },
            rollback: { attempted: 1, removed: 1, failed: [] }
        });

        await handleToolCall({
            toolName: 'batchOperations',
            parameters: {
                operations: [
                    {
                        opId: 'create-ok',
                        action: 'createNode',
                        params: { type: 'FRAME', name: 'Transient Node' }
                    },
                    {
                        opId: 'bad-op',
                        action: 'setNodeLayout',
                        params: { nodeRef: 'create-ok', layoutMode: 'HORIZONTAL' }
                    }
                ]
            },
            requestId: 'test-req-rollback'
        });

        const toolResultCall = (emit as any).mock.calls.find((call: any[]) => call[0] === 'TOOL_RESULT');
        const payload = toolResultCall?.[1];
        
        expect(payload.response.success).toBe(false);
        // Verify rollback info is propagated
        expect(payload.response.data.rollback).toEqual(
            expect.objectContaining({ attempted: 1, removed: 1 })
        );
    });
});
