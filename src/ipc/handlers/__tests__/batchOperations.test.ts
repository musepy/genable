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
        // Setup: Parent creation mock
        const parentNodeId = '100:1';
        (handleUnifiedRender as any).mockResolvedValueOnce({ id: parentNodeId, name: 'Parent' });

        // Setup: Child creation mock
        const childNodeId = '100:2';
        (handleUnifiedRender as any).mockResolvedValueOnce({ id: childNodeId, name: 'Child' });

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

        // Verification: parent frame should be created first with no parent (null)
        expect(handleUnifiedRender).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ props: expect.objectContaining({ name: 'Parent Container' }) }),
            false,
            null
        );

        // Verification: child frame should be created with the resolved parentNodeId
        expect(handleUnifiedRender).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ props: expect.objectContaining({ name: 'Child Content' }) }),
            false,
            parentNodeId // This is the resolved parentRef
        );

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
                    layoutSnapshots: expect.objectContaining({
                        'parent-frame': expect.objectContaining({ id: parentNodeId }),
                        'child-frame': expect.objectContaining({ id: childNodeId })
                    })
                })
            })
        }));
    });

    it('should resolve virtual IDs (opId) across siblings', async () => {
        // Setup mocks
        const parentId = '100:1';
        const sibling1Id = '100:2';
        (handleUnifiedRender as any).mockResolvedValueOnce({ id: parentId, name: 'Container' });
        (handleUnifiedRender as any).mockResolvedValueOnce({ id: sibling1Id, name: 'Sibling1' });

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

        (nodeLayoutService.applyStyles as any).mockResolvedValueOnce({ success: true });

        // Execution
        await handleToolCall({
            toolName: 'batchOperations',
            parameters: batchParams,
            requestId: 'test-req-2'
        });

        // Verification: setNodeStyles resolved 'item1' to sibling1Id
        expect(nodeLayoutService.applyStyles).toHaveBeenCalledWith(
            sibling1Id,
            expect.objectContaining({ fills: expect.any(Array) })
        );
    });
});
