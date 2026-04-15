import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IpcBridge } from '../ipcBridge';
import { on, emit } from '@create-figma-plugin/utilities';

vi.mock('@create-figma-plugin/utilities', () => ({
  on: vi.fn(),
  emit: vi.fn(),
}));

describe('IpcBridge (Sandbox Thread)', () => {
  let bridge: IpcBridge;
  let onCallback: (data: any) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    // Capture the 'TOOL_RESULT' callback
    (on as any).mockImplementation((event: string, cb: any) => {
      console.log(`Mock on called for: ${event}`);
      if (event === 'TOOL_RESULT') {
        onCallback = cb;
      }
    });

    // Create a fresh instance for each test
    bridge = new IpcBridge();
  });

  afterEach(() => {
    bridge.dispose();
    vi.useRealTimers();
  });

  it('T1.2.1: should emit TOOL_CALL and resolve when TOOL_RESULT is received', async () => {
    const mockParams = { query: 'test' };
    const mockResponse = { data: { found: true } };

    // Start the tool call
    const callPromise = bridge.callTool('searchDesignKnowledge', mockParams);

    // Verify emit was called
    expect(emit).toHaveBeenCalledWith('TOOL_CALL', expect.objectContaining({
      toolName: 'searchDesignKnowledge',
      parameters: mockParams,
      requestId: expect.stringMatching(/^req_/)
    }));

    // Get the requestId from the emit call
    const emittedData = (emit as any).mock.calls[0][1];
    const requestId = emittedData.requestId;

    // Simulate receiving the response
    onCallback({
      requestId,
      response: mockResponse
    });

    const result = await callPromise;
    expect(result).toEqual(mockResponse);
  });

  it('T1.2.2: should return TIMEOUT result if no response is received', async () => {
    const callPromise = bridge.callTool('someTool', {}, undefined, 1000);

    // Fast-forward time
    vi.advanceTimersByTime(1100);

    const result = await callPromise;
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.error).toContain('timed out');
  });

  it('should ignore TOOL_RESULT for unknown requestIds', async () => {
    const mockParams = { x: 1 };
    const callPromise = bridge.callTool('testTool', mockParams);

    // Simulate result for wrong ID
    onCallback({
      requestId: 'wrong-id',
      response: {}
    });

    // Promise should still be pending
    // We can check if it resolves eventually or times out
    vi.advanceTimersByTime(31000); // Wait for default timeout
    const result = await callPromise;
    expect(result.error).toContain('timed out');
  });

  it('should reject pending requests on dispose', async () => {
     const callPromise = bridge.callTool('testTool', {});
     
     bridge.dispose();
     
     await expect(callPromise).rejects.toThrow('IpcBridge disposed');
  });
});
