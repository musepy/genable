/**
 * @file unified/index.ts
 * @description Barrel export for unified tool definitions.
 *
 * LLM-facing API: a single `run` tool that dispatches to individual commands.
 *
 * VFS spike: ls/cat/tree (filesystem metaphor) replace context/outline/inspect.
 * Write commands (design, replace, query) unchanged.
 */

// VFS read commands — filesystem metaphor
export { lsDefinition, catDefinition, treeDefinition } from './vfs';

// Write commands — batch
export { designDefinition } from './design';
export { replaceDefinition } from './replace';
export { queryDefinition } from './query';

// FS write commands — path-based create/modify/delete
export {
  mkdirDefinition, mktextDefinition, writeDefinition,
  rmDefinition, cpDefinition, lnDefinition,
} from './fs';

// Command registry — internal dispatch, help, and validation
export {
  COMMAND_NAMES,
  isValidCommand,
  getCommandDefinition,
  getAllCommandDefinitions,
  getCommandHelp,
} from './commandRegistry';

// CLI command parser
export {
  parseCommandString,
  mapToToolArgs,
  type ParsedCommand,
  type ParsedChain,
} from './commandParser';

// LLM-facing tool
export { runDefinition } from './run';

import { runDefinition } from './run';
import { ToolDefinition } from '../types';

/**
 * Primary tool set for LLM function calling.
 * Single `run` tool — dispatches to individual commands internally.
 */
export const unifiedTools: ToolDefinition[] = [runDefinition];
