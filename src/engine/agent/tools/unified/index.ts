/**
 * @file unified/index.ts
 * @description Barrel export for unified tool definitions.
 *
 * LLM-facing API: a single `run` tool that dispatches to individual commands.
 * VFS read: ls/cat/tree. Write: mk/mv/rm/cp. Search: grep/sed. Knowledge: man.
 */

// VFS read commands — filesystem metaphor
export { lsDefinition, catDefinition, treeDefinition } from './vfs';

// Unix CLI commands
export { mkDefinition } from './mk';
export { grepDefinition } from './grep';
export { sedDefinition } from './sed';
export { manDefinition } from './man';

// FS write commands — path-based
export { rmDefinition, cpDefinition } from './fs';

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
  parseMkArgs,
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
