import { ToolDefinition } from '../types';

/**
 * Unified flow control — replaces planDesign, new_task, update_todo_list, summarize_progress, complete_task.
 * Single entry point for all agent lifecycle signals.
 */
export const signalDefinition: ToolDefinition = {
  name: 'signal',
  category: 'control',
  description: `Send a lifecycle signal to the system. This is the ONLY tool for flow control and progress reporting.

Types:
- "plan": Create an execution plan (analysis + steps). MUST be called before creating designs.
- "task_start": Signal the start of a semantic task (shows a Task Card in UI).
- "progress": Report incremental progress or update sub-step statuses.
- "complete": Signal task completion. You MUST call this to end execution — do NOT just stop responding.`,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['plan', 'task_start', 'progress', 'complete'],
        description: 'Signal type.'
      },
      // Plan fields
      analysis: {
        type: 'string',
        description: '[plan] Analysis of the user request and design requirements.'
      },
      steps: {
        type: 'array',
        description: '[plan] Ordered list of high-level design milestones.',
        items: {
          type: 'object',
          description: 'Step definition.',
          properties: {
            stepNumber: { type: 'number', description: 'Step order' },
            action: { type: 'string', description: 'What to build' },
            nodes: { type: 'array', items: { type: 'string', description: 'Node name' }, description: 'Nodes to create' },
            reasoning: { type: 'string', description: 'Why' }
          }
        }
      },
      // Task start fields
      title: {
        type: 'string',
        description: '[task_start, complete] Task title or completion summary.'
      },
      description: {
        type: 'string',
        description: '[task_start] Brief task description.'
      },
      // Progress fields
      summary: {
        type: 'string',
        description: '[progress, complete] Summary of what has been achieved.'
      },
      items: {
        type: 'array',
        description: '[progress] Todo items with status updates.',
        items: {
          type: 'object',
          description: 'Todo item with status.',
          properties: {
            id: { type: 'string', description: 'Todo ID' },
            label: { type: 'string', description: 'Todo description' },
            status: { type: 'string', enum: ['pending', 'completed', 'failed'], description: 'Status' }
          }
        }
      },
      // Completion fields
      isComplete: {
        type: 'boolean',
        description: '[progress] Whether this signals task completion.'
      },
      verification: {
        type: 'string',
        description: '[complete] How user can verify the result.'
      }
    },
    required: ['type']
  },
  executionStrategy: 'sequential',
  errors: {
    'INVALID_TYPE': 'Type must be one of: plan, task_start, progress, complete.'
  }
};
