/**
 * @file memoryTool.ts
 * @description Persistent memory tools — verb_noun first-class tools.
 *
 * 3 tools: list_memories, save_memory, delete_memory.
 * Backed by figma.clientStorage via memoryStore.
 */

import { ToolDefinition } from '../types';

export const listMemoriesDefinition: ToolDefinition = {
  name: 'list_memories',
  executionStrategy: 'parallel',
  description: `List or read persistent memories that survive across sessions.

Without key: returns all memory keys and values.
With key: returns a specific memory value.

Examples:
  list_memories()
  list_memories({key: "brand-colors"})`,
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Optional — read a specific memory by key',
      },
    },
  },
};

export const saveMemoryDefinition: ToolDefinition = {
  name: 'save_memory',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Save a persistent memory. Creates or updates a key-value pair that persists across sessions.

Use for: user preferences, brand colors, typography choices, design system notes.

Examples:
  save_memory({key: "brand-colors", value: "Primary: #2563EB, Secondary: #64748B"})
  save_memory({key: "typography", value: "Headlines: Space Grotesk 32px. Body: Inter 16px."})`,
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Memory key (e.g. "brand-colors", "typography")',
      },
      value: {
        type: 'string',
        description: 'Value to store',
      },
    },
    required: ['key', 'value'],
  },
};

export const deleteMemoryDefinition: ToolDefinition = {
  name: 'delete_memory',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Delete a persistent memory by key.

Examples:
  delete_memory({key: "brand-colors"})`,
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Memory key to delete',
      },
    },
    required: ['key'],
  },
};
