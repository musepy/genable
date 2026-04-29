/**
 * @file askUser.ts
 * @description Tool definition for the `ask_user` command.
 *
 * Presents the user with 1-4 questions in a single form. Each question has
 * its own options and can be single- or multi-select. Pauses agent execution
 * until the user submits the form (or types a free-form answer in chat).
 *
 * Schema aligned with Claude Code's AskUserQuestion (questions array, optional
 * header per question, multiSelect bool).
 */

import type { ToolDefinition } from '../types';

export const askUserDefinition: ToolDefinition = {
  name: 'ask_user',
  executionStrategy: 'sequential',
  mutates: false,
  description: `Ask the user 1-4 questions in a single form. Each question has its own options and can be single- or multi-select. Bundle related decisions in ONE call instead of multiple turns.

Use when:
- The prompt is ambiguous on multiple dimensions (audience + aesthetic + length) — bundle them into one form
- You need a decision before proceeding (delete existing? which section first?)
- Multiple valid approaches exist and user preference matters

Returns one of:
- { answers: [...] } — array indexed to questions order. string for single-select, string[] for multi-select. The string MAY be one of the option labels OR custom text the user typed via the auto-injected "Other..." option.
- { freeText: "..." } — when the user typed a free-form answer in the chat input instead of submitting the form. Treat as authoritative — user is overriding the structured options.

Each question:
- question: required prompt string
- header: optional short label shown above (e.g. "Audience", "Aesthetic"). Max ~12 chars — used as a tab chip in the form.
- options: 2-4 options, each { label, description? }
- multiSelect: optional boolean (default false). Use only when the answer is genuinely a list (e.g. "which features?"). For mutually exclusive choices keep false.

Conventions:
- **First option = recommended.** If you have a strong default for the user, put it FIRST and add "(Recommended)" at the end of the label. The form auto-focuses the first option and the dev/auto-pick fallback selects it — both work better with a deliberate recommendation.
- **Do NOT include an "Other" option yourself** — the form auto-injects an "Other..." button per question that expands to an inline text input. Don't add a redundant one.
- **Bundle aggressively.** 2 related dimensions in ONE call beats 2 sequential turns. The form already groups them via tab nav.

Example:
  ask_user({ questions: [
    { header: "Audience", question: "Who is this for?", options: [{label:"B2B SaaS"},{label:"Consumer"},{label:"Developer tool"},{label:"Personal portfolio"}] },
    { header: "Aesthetic", question: "What visual direction?", options: [{label:"Minimal"},{label:"Bold/Brutalist"},{label:"Neon/Cyber"},{label:"Surprise me"}] }
  ]})

Skip when the prompt is already actionable — asking adds a turn and costs momentum.`,
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '1-4 questions to present in a single form',
        maxItems: 4,
        items: {
          type: 'object',
          description: 'A single question with its own options and select mode',
          properties: {
            question: { type: 'string', description: 'The question prompt' },
            header: { type: 'string', description: 'Optional short header/label shown above the question (e.g. "Audience", "Aesthetic")' },
            options: {
              type: 'array',
              description: '2-4 options for this question',
              maxItems: 4,
              items: {
                type: 'object',
                description: 'A single option (label + optional description)',
                properties: {
                  label: { type: 'string', description: 'Short option label' },
                  description: { type: 'string', description: 'Brief explanation of this option' },
                },
                required: ['label'],
              },
            },
            multiSelect: { type: 'boolean', description: 'When true, allow multiple options to be selected. Default false (single-select).' },
          },
          required: ['question', 'options'],
        },
      },
    },
    required: ['questions'],
  },
};
