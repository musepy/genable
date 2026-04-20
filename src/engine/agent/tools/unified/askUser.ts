/**
 * @file askUser.ts
 * @description Tool definition for the `ask_user` command.
 *
 * Presents the user with a question and selectable options.
 * Pauses agent execution until the user responds.
 */

import type { ToolDefinition } from '../types';

export const askUserDefinition: ToolDefinition = {
  name: 'ask_user',
  executionStrategy: 'sequential',
  mutates: false,
  description: `Ask the user a question with selectable options. Use when:
- The prompt is ambiguous and you need clarification (dark/light theme, layout style)
- Multiple valid approaches exist and user preference matters
- You need a decision before proceeding (delete existing content? which section first?)

Input: question string + 2-4 options with label and optional description.
Returns: the user's selected option label, OR custom text if the user typed a free-form answer instead of picking an option.

Skip when the instruction is already actionable — asking adds a turn and costs momentum without reducing ambiguity.`,
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user',
      },
      options: {
        type: 'array',
        description: 'Selectable options (2-4)',
        items: {
          type: 'object',
          description: 'A single option',
          properties: {
            label: { type: 'string', description: 'Short option label' },
            description: { type: 'string', description: 'Brief explanation of this option' },
          },
          required: ['label'],
        },
        maxItems: 4,
      },
    },
    required: ['question', 'options'],
  },
};
