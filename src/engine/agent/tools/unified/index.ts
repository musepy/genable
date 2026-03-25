/**
 * @file unified/index.ts
 * @description Barrel export for unified tool definitions.
 *
 * LLM-facing API: jsx, inspect, edit (first-class) + `run` tool for power operations.
 * Write: mv/rm/cp. Search: grep/sed. Knowledge: man. Script: js/var/comp.
 */

// Unix CLI commands
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

// LLM-facing tools
export { runDefinition } from './run';

import { runDefinition } from './run';
import { jsxDefinition } from './jsx';
import { inspectDefinition } from './inspect';
import { editDefinition } from './edit';
import { ToolDefinition } from '../types';

/**
 * Primary tool set for LLM function calling.
 * - `jsx` — tree creation via JSX markup (nesting IS hierarchy)
 * - `inspect` — read design nodes (list/tree/detail)
 * - `edit` — update existing node properties
 * - `run` — power operations (mv, rm, cp, grep, sed, js, var, comp, etc.)
 */
export const unifiedTools: ToolDefinition[] = [
  jsxDefinition,
  inspectDefinition,
  editDefinition,
  runDefinition,
];
