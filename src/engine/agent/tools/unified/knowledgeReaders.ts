/**
 * @file knowledgeReaders.ts
 * @description One reader tool per knowledge category — flat schema.
 *
 * Each tool loads a single entry by its bare name (no category prefix).
 * The category is implicit in the tool name: `skill({ name: "restyle" })`
 * resolves to the entry with id `skill:restyle`.
 *
 * Replaces the old single `knowledge({ id })` tool that required the LLM to
 * stitch a `<category>:<name>` prefix into one parameter. Dedicated tools make
 * the call shape `tool({ name })` — one tool name, one parameter, no prefix.
 */
import { ToolDefinition } from '../types';

interface ReaderSpec {
  category: string;
  oneLine: string;
  example: string;
}

const SPECS: ReaderSpec[] = [
  {
    category: 'skill',
    oneLine:
      'Load a procedural skill — workflow + tool sequence + anti-patterns. Use FIRST when the user is changing/adjusting existing canvas, OR before creating a new design if a matching skill exists.',
    example: 'restyle',
  },
  {
    category: 'style',
    oneLine:
      'Load a visual style preset as INSPIRATION — color tokens, typography, shape, depth. Treat as a reference library, not a cage: pick one wholesale, mix elements, or invent your own. You are not restricted to the menu.',
    example: 'neon-cyber',
  },
  {
    category: 'guideline',
    oneLine:
      'Load a page-type design guideline — layout patterns for landing pages, dashboards, login flows, forms, etc.',
    example: 'form',
  },
  {
    category: 'help',
    oneLine:
      'Load narrow how-to / process help — tool usage rules, edge cases, naming conventions.',
    example: 'interaction-model',
  },
];

function makeDef(spec: ReaderSpec): ToolDefinition {
  return {
    name: spec.category,
    executionStrategy: 'parallel',
    description: `${spec.oneLine}\n\nExample: ${spec.category}({ name: "${spec.example}" })`,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: `The ${spec.category} name exactly as it appears in the KNOWLEDGE LIBRARY menu — no "${spec.category}:" prefix, no quotes.`,
        },
      },
      required: ['name'],
    },
  };
}

export const skillDefinition: ToolDefinition = makeDef(SPECS[0]);
export const styleDefinition: ToolDefinition = makeDef(SPECS[1]);
export const guidelineDefinition: ToolDefinition = makeDef(SPECS[2]);
export const helpDefinition: ToolDefinition = makeDef(SPECS[3]);

export const knowledgeReaders: ToolDefinition[] = [
  skillDefinition,
  styleDefinition,
  guidelineDefinition,
  helpDefinition,
];

/** Categories handled by reader tools — used by useChat to wire executors. */
export const READER_CATEGORIES = SPECS.map(s => s.category) as readonly string[];
