/**
 * @file hooks/index.ts
 * @description Public API for the Hook system.
 */

export { HookRegistry } from './hookRegistry';
export { HookRunner } from './hookRunner';
export { createBuiltinHooks, createBuiltinHooksWithState } from './builtinHooks';
export type {
  HookEvent,
  HookAction,
  HookResult,
  HookContext,
  HookFn,
  HookRegistration,
} from './hookTypes';
