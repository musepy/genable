/**
 * @file toolCallHandler.ts
 * @description IPC handler for TOOL_CALL events — thin router.
 *
 * Delegates to command handlers in src/ipc/commands/.
 * Only responsibilities: route, catch, emit result.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { emit } from '@create-figma-plugin/utilities';
import { logger } from '../../utils/logger';
import { dispatchCommand } from '../commands';

export interface ToolCallData {
  toolName: string;
  parameters: any;
  requestId: string;
}

export async function handleToolCall(data: ToolCallData): Promise<void> {
  const { toolName, parameters, requestId } = data;

  try {
    const response = await dispatchCommand(toolName, parameters);
    emit('TOOL_RESULT', { requestId, response });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[toolCallHandler] ${toolName} threw: ${message}`);
    emit('TOOL_RESULT', {
      requestId,
      response: {
        success: false,
        error: { code: 'INTERNAL_ERROR', message },
      } as ToolResponse,
    });
  }
}
