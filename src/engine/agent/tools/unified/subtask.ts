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

Use when the prompt names 3+ distinct regions (e.g. header, sidebar, main) that share no nodes, or when specialized behavior is needed (audit, token ops). For 1-2 tool-call operations, inline calls finish faster than the subtask spin-up cost.`,
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
