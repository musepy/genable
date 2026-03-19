/**
 * @file token.ts
 * @description Tool definition for the `token` command.
 *
 * Runtime style token management — agent can customize its own visual vocabulary.
 */

import type { ToolDefinition } from '../types';

export const tokenDefinition: ToolDefinition = {
  name: 'token',
  category: 'modify',
  executionStrategy: 'sequential',
  display: { displayName: 'Token', group: 'style' },
  description: `View and customize style tokens used by render command.

Subcommands:
  token ls                                    list all tokens
  token ls text                               text tokens only
  token ls container                          container tokens only
  token set bubble fill:#1E1B4B corner:20     update existing token
  token set my-label --text size:14 fill:#666 create new text token
  token set my-box --container p:32 fill:#FFF create new container token
  token rm my-label                           remove custom token
  token reset                                 reset all to defaults

Tokens define visual styles for the render command.
Agent can customize its own presentation (e.g. bubble style for replies).`,
  parameters: {
    type: 'object',
    properties: {
      subcommand: {
        type: 'string',
        description: 'ls, set, rm, reset',
        enum: ['ls', 'set', 'rm', 'reset'],
      },
      name: {
        type: 'string',
        description: 'Token name',
      },
      propTokens: {
        type: 'array',
        items: { type: 'string', description: 'key:value pair' },
        description: 'Property tokens (key:value pairs)',
      },
      tokenType: {
        type: 'string',
        description: 'Force token type for new tokens',
        enum: ['text', 'container'],
      },
      filter: {
        type: 'string',
        description: 'Filter for ls: text or container',
        enum: ['text', 'container'],
      },
    },
    required: ['subcommand'],
  },
};
