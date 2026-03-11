/**
 * @file unified/index.ts
 * @description Barrel export for all unified tool definitions.
 * LLM-facing API: context | outline | inspect | design | replace | query
 */

export { contextDefinition } from './context';
export { outlineDefinition } from './outline';
export { inspectDefinition } from './inspect';
export { designDefinition } from './design';
export { replaceDefinition } from './replace';
export { queryDefinition } from './query';

import { contextDefinition } from './context';
import { outlineDefinition } from './outline';
import { inspectDefinition } from './inspect';
import { designDefinition } from './design';
import { replaceDefinition } from './replace';
import { queryDefinition } from './query';

import { ToolDefinition } from '../types';

/**
 * Primary tool set for LLM function calling.
 */
export const unifiedTools: ToolDefinition[] = [
  contextDefinition,
  outlineDefinition,
  inspectDefinition,
  designDefinition,
  replaceDefinition,
  queryDefinition,
];
