/**
 * @file emptyArgsGuard.ts
 * @description Guards against LLM returning tool calls with empty/null arguments.
 *
 * Two hooks cooperate:
 *  - afterLLMResponse: counts iterations with empty-args calls, aborts after threshold,
 *    injects a self-correct hint message.
 *  - beforeToolExec: skips individual tool calls that have empty args.
 *
 * Replaces the inline emptyArgs guard from agentRuntime.ts.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';

const MAX_EMPTY_ARGS_ITERATIONS = 3;

interface EmptyArgsState {
  emptyArgsCount: number;
}

function isEmptyArgs(args: any): boolean {
  return (
    args == null
    || (typeof args === 'object' && Object.keys(args).length === 0)
    || args === ''
  );
}

function createEmptyArgsCounterHook(state: EmptyArgsState): HookRegistration {
  return {
    id: 'builtin:emptyArgsCounter',
    event: 'afterLLMResponse',
    priority: 5, // run before emptyResponse check
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      if (!ctx.toolCalls || ctx.toolCalls.length === 0) return;

      const emptyArgsCalls = ctx.toolCalls.filter(tc => isEmptyArgs(tc.args));
      if (emptyArgsCalls.length === 0) {
        state.emptyArgsCount = 0;
        return;
      }

      state.emptyArgsCount++;
      const names = emptyArgsCalls.map(tc => tc.name).join(', ');

      if (state.emptyArgsCount > MAX_EMPTY_ARGS_ITERATIONS) {
        return {
          action: 'abort',
          reason: `Model repeatedly returns empty tool arguments (${MAX_EMPTY_ARGS_ITERATIONS}+ times). Aborting.`,
        };
      }

      console.warn(
        `[Hook:emptyArgs] ${emptyArgsCalls.length} tool call(s) with empty args: ${names} (${state.emptyArgsCount}/${MAX_EMPTY_ARGS_ITERATIONS})`
      );

      return {
        action: 'continue',
        injectMessage: `Your tool call to ${names} had empty arguments and was not executed. Please provide the required parameters (e.g. xml for create/edit) and try again.`,
      };
    },
  };
}

function createEmptyArgsSkipHook(): HookRegistration {
  return {
    id: 'builtin:emptyArgsSkip',
    event: 'beforeToolExec',
    priority: 10,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      if (!ctx.currentToolCall) return;
      if (isEmptyArgs(ctx.currentToolCall.args)) {
        return {
          action: 'skip',
          reason: `Tool call "${ctx.currentToolCall.name}" has empty arguments.`,
        };
      }
    },
  };
}

export function createEmptyArgsGuard(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  const state: EmptyArgsState = { emptyArgsCount: 0 };

  return {
    hooks: [
      createEmptyArgsCounterHook(state),
      createEmptyArgsSkipHook(),
    ],
    reset: () => {
      state.emptyArgsCount = 0;
    },
  };
}
