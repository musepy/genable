/**
 * @file subtask.ts
 * @description Command definition for the `subtask` command.
 * Delegates a portion of work to a child agent with its own iteration budget.
 */

import { ToolDefinition } from '../types';
import { getAgentTypeDescriptions } from '../../subtask/agentTypes';

export const subtaskDefinition: ToolDefinition = {
  name: 'subtask',
  executionStrategy: 'sequential',
  description: `Delegate a focused sub-task to a typed child agent. Each type has its own tools, iteration budget, and behavioral constraints.

Available agent types:
${getAgentTypeDescriptions()}

Use when a design has 3+ independent sections or when you need specialized behavior (audit, token ops). Do NOT use for simple operations (1-2 tool calls).`,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Description of the sub-task to delegate. Be specific about what to create/modify/audit.',
      },
      type: {
        type: 'string',
        enum: ['create', 'audit', 'token'],
        description: 'Agent type. Defaults to "create" if omitted.',
      },
    },
    required: ['prompt'],
  },
};
