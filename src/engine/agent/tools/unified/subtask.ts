/**
 * @file subtask.ts
 * @description Command definition for the `subtask` command.
 * Delegates a portion of work to a child agent with its own iteration budget.
 */

import { ToolDefinition } from '../types';

export const subtaskDefinition: ToolDefinition = {
  name: 'subtask',
  category: 'control',
  display: { displayName: 'Subtask', group: 'control' },
  executionStrategy: 'sequential',
  description: 'Delegate a focused sub-task to a child agent. Usage: subtask <prompt>. The child agent shares your tools and canvas but has its own iteration budget. Use for independent pieces of complex designs (e.g., sidebar, header, form section).',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Description of the sub-task to delegate. Be specific about what to create/modify.',
      },
      input: {
        type: 'string',
        description: 'Alternative to prompt — same effect.',
      },
    },
    required: [],
  },
};
