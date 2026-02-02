import { ToolDefinition } from './types';

export const workflowTools: ToolDefinition[] = [
  {
    name: 'new_task',
    description: 'Signals the start of a clear semantic task. Triggers a new Task Card in the UI.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'A concise title for the task (e.g., "Create Login UI").'
        },
        description: {
          type: 'string',
          description: 'A brief description of what this task accomplishes.'
        },
        stepId: {
          type: 'string',
          description: 'Optional ID. Use this if you are continuing or refining a specific step from a previous plan.'
        }
      },
      required: ['title']
    },
    executionStrategy: 'parallel',
    category: 'plan'
  },
  {
    name: 'update_todo_list',
    description: 'Dynamically manages sub-steps (todos) within the current active task.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'List of todo items.',
          items: {
            type: 'object',
            description: 'A single todo item.',
            properties: {
              id: { type: 'string', description: 'Unique ID for the todo item.' },
              label: { type: 'string', description: 'Human-readable description of the todo.' },
              status: { 
                type: 'string', 
                enum: ['pending', 'completed', 'failed'],
                description: 'Current status of this specific sub-item.'
              }
            },
            required: ['id', 'label', 'status']
          }
        }
      },
      required: ['items']
    },
    executionStrategy: 'parallel',
    category: 'plan'
  },
  {
    name: 'summarize_progress',
    description: 'Periodically reports high-level progress or completes a task.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'A user-friendly summary of what has been achieved.'
        },
        isComplete: {
          type: 'boolean',
          description: 'Whether this signals the completion of the current task.'
        },
        nextMilestone: {
          type: 'string',
          description: 'Optional hint about what the agent will work on next.'
        }
      },
      required: ['summary']
    },
    executionStrategy: 'parallel',
    category: 'plan'
  }
];
