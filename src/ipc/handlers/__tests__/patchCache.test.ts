import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToolCall } from '../toolCallHandler';
import { nodeLayoutService } from '../../../engine/services';
import { patchCache } from '../../../engine/validation/patchCache';
import { planState } from '../../../engine/agent/planState';
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
    resolveParent: vi.fn(),
  },
}));

vi.mock('../../../engine/agent/planState', () => ({
  planState: {
    completeTask: vi.fn(),
    startTask: vi.fn(),
  },
}));

describe('PatchCache Integration in toolCallHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        patchCache.clear();
    });

    it('should skip redundant setNodeLayout calls and complete task', async () => {
        const nodeId = '100:1';
        const stepId = 'step-1';
        const layoutParams = {
            nodeId,
            layoutMode: 'HORIZONTAL',
            gap: 10,
            stepId
        };

        (nodeLayoutService.applyLayout as any).mockResolvedValue({ success: true, data: { nodeId } });

        // First call - should execute
        await handleToolCall({
            toolName: 'setNodeLayout',
            parameters: layoutParams,
            requestId: 'req-1'
        });
        expect(nodeLayoutService.applyLayout).toHaveBeenCalledTimes(1);
        expect(planState.completeTask).toHaveBeenCalledWith(stepId);

        // Second call with same params - should skip but still complete task
        await handleToolCall({
            toolName: 'setNodeLayout',
            parameters: layoutParams,
            requestId: 'req-2'
        });
        expect(nodeLayoutService.applyLayout).toHaveBeenCalledTimes(1);
        expect(planState.completeTask).toHaveBeenCalledTimes(2);
        expect(planState.completeTask).toHaveBeenLastCalledWith(stepId);

        // Verify clean success response (no skipped flag to avoid agent confusion)
        expect(emit).toHaveBeenLastCalledWith('TOOL_RESULT', expect.objectContaining({
            requestId: 'req-2',
            response: expect.objectContaining({
                success: true,
                data: expect.objectContaining({ nodeId: '100:1' })
            })
        }));
    });

    it('should skip redundant setNodeStyles calls and complete task', async () => {
        const nodeId = '100:2';
        const stepId = 'step-2';
        const styleParams = {
            nodeId,
            fills: ['#FF0000'],
            stepId
        };

        (nodeLayoutService.applyStyles as any).mockResolvedValue({ success: true, data: { nodeId } });

        // First call
        await handleToolCall({
            toolName: 'setNodeStyles',
            parameters: styleParams,
            requestId: 'req-3'
        });
        expect(nodeLayoutService.applyStyles).toHaveBeenCalledTimes(1);
        expect(planState.completeTask).toHaveBeenCalledWith(stepId);

        // Second call
        await handleToolCall({
            toolName: 'setNodeStyles',
            parameters: styleParams,
            requestId: 'req-4'
        });
        expect(nodeLayoutService.applyStyles).toHaveBeenCalledTimes(1);
        expect(planState.completeTask).toHaveBeenCalledTimes(2);
    });

    it('should skip redundant applyDesignPatch calls and complete task', async () => {
        const nodeId = '100:3';
        const stepId = 'step-3';
        const patchParams = {
            patches: [{
                nodeId,
                styles: { fills: ['#00FF00'] }
            }],
            stepId
        };

        (nodeLayoutService.applyStyles as any).mockResolvedValue({ success: true, data: { nodeId } });

        // First call
        await handleToolCall({
            toolName: 'applyDesignPatch',
            parameters: patchParams,
            requestId: 'req-5'
        });
        expect(nodeLayoutService.applyStyles).toHaveBeenCalledTimes(1);
        expect(planState.completeTask).toHaveBeenCalledWith(stepId);

        // Second call
        await handleToolCall({
            toolName: 'applyDesignPatch',
            parameters: patchParams,
            requestId: 'req-6'
        });
        expect(nodeLayoutService.applyStyles).toHaveBeenCalledTimes(1);
        // Important: applyDesignPatch should also mark task as complete when skipped
        expect(planState.completeTask).toHaveBeenCalledTimes(2);
    });
});
