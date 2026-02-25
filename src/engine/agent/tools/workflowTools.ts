import { ToolDefinition } from './types';

export const workflowTools: ToolDefinition[] = [
  {
    name: 'new_task',
    modes: ['PLANNING'],
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
    modes: ['PLANNING', 'EXECUTION', 'RECOVERY'],
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
    modes: ['EXECUTION', 'VERIFICATION', 'RECOVERY'],
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
  },
  {
    name: 'complete_task',
    modes: ['EXECUTION', 'VERIFICATION', 'RECOVERY'],
    description: `[REQUIRED] Signal task completion. You MUST call this tool to end execution. Do NOT just stop responding - explicitly call this tool with a summary.`,
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Summary of what was accomplished'
        },
        verification: {
          type: 'string',
          description: 'Optional: how user can verify the result'
        }
      },
      required: ['summary']
    },
    executionStrategy: 'sequential',
    category: 'control'
  },
  {
    name: 'complete_step',
    modes: ['EXECUTION', 'RECOVERY'],
    description: 'Mark the current plan step as complete and advance to the next step. Use this when the current step\'s work was already accomplished in a previous step, or when you have finished executing the current step.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of what was accomplished (or "Already completed in previous step").'
        },
        reason: {
          type: 'string',
          enum: ['completed', 'already_done', 'merged_with_previous'],
          description: 'Why this step is being completed.'
        }
      },
      required: ['summary']
    },
    executionStrategy: 'sequential',
    category: 'plan'
  }
];
