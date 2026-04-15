import { on, emit } from '@create-figma-plugin/utilities';
import { ToolResponse, ToolContext } from './tools/types';
import { ToolResultHandler, ToolCallHandler } from '../../types';
import { IPC_CONSTANTS } from './constants';

/**
 * @class IpcBridge
 * @description Facilitates asynchronous tool calls between the engine (Sandbox) and Figma (Main).
 */
export class IpcBridge {
  private pendingRequests: Map<string, {
    resolve: (value: ToolResponse) => void;
    reject: (reason: any) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(
    private config: {
      defaultTimeoutMs?: number;
      logger?: { log: (...args: any[]) => void; error: (...args: any[]) => void; };
    } = {}
  ) {
    this.setupListeners();
  }

  public dispose(): void {
    // Clear all pending requests
    for (const [requestId, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('IpcBridge disposed'));
    }
    this.pendingRequests.clear();
    
    // Note: @create-figma-plugin/utilities currently doesn't export 'off', 
    // so we rely on the plugin environment to cleanup the global listeners 
    // or we might need to patch utilities if listener leaks become an issue.
    // However, since IpcBridge is usually 1:1 with the agent session, 
    // preventing resolution of destroyed promises is the main goal.
  }

  private setupListeners() {
    on<ToolResultHandler>('TOOL_RESULT', (data) => {
      const request = this.pendingRequests.get(data.requestId);
      if (request) {
        clearTimeout(request.timeout);
        this.pendingRequests.delete(data.requestId);
        request.resolve(data.response);
      }
    });
  }

  /**
   * Calls a tool defined on the Figma main thread.
   * @param toolName The name of the tool to execute.
   * @param parameters The arguments passed to the tool.
   * @param context Optional context for the tool execution.
   * @param timeoutMs Maximum time to wait for a response (default 30s).
   */
  public async callTool<R = any>(
    toolName: string,
    parameters: any,
    context?: ToolContext,
    timeoutMs: number = this.config.defaultTimeoutMs || IPC_CONSTANTS.DEFAULT_TIMEOUT_MS
  ): Promise<ToolResponse<R>> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise<ToolResponse<R>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          resolve({
            error: `Tool call '${toolName}' timed out after ${timeoutMs}ms`
          });
        }
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as any,
        reject,
        timeout
      });

      emit<ToolCallHandler>('TOOL_CALL', {
        toolName,
        parameters,
        context,
        requestId
      });
    });
  }
}
