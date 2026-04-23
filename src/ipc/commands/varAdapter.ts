/**
 * @file varAdapter.ts
 * @description Re-export variable tool handlers for the command registry.
 *
 * Handlers live in varHandlers.ts and accept tool-shaped params directly.
 * This file exists only so the registry import path stays stable.
 */

export {
  handleListVariables,
  handleCreateCollection,
  handleCreateVariable,
  handleSetVariableValue,
  handleBindVariable,
  handleSetVariableMode,
} from './varHandlers';
