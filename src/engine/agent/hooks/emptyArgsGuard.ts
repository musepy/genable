/**
 * @file emptyArgsGuard.ts
 * @description Guards against LLM returning tool calls with malformed arguments
 * (null, non-object, empty string). Empty object `{}` is VALID — some tools
 * (e.g. list_variables, get_selection) accept zero-arg invocation; blocking
 * those would break legitimate queries.
 *
 * Two hooks cooperate:
 *  - afterLLMResponse: counts iterations with malformed-args calls, aborts
 *    after threshold, injects a self-correct hint message.
 *  - beforeToolExec: skips individual tool calls that have malformed args.
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';

const MAX_EMPTY_ARGS_ITERATIONS = 3;

interface EmptyArgsState {
  emptyArgsCount: number;
}

/**
 * Detects malformed tool args. Empty object `{}` is NOT malformed — it is a
 * valid zero-arg call for tools whose schema has no required parameters.
 */
function isEmptyArgs(args: any): boolean {
  return args == null || typeof args !== 'object' || Array.isArray(args);
}

function createEmptyArgsCounterHook(state: EmptyArgsState): HookRegistration {
  return {
    id: 'builtin:emptyArgsCounter',
    event: 'afterLLMResponse',
    priority: 5, // run before emptyResponse check
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      if (!ctx.toolCalls || ctx.toolCalls.length === 0) return;

      const emptyArgsCalls = ctx.toolCalls.filter(tc => isEmptyArgs(tc.input));
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
        `[Hook:emptyArgs] ${emptyArgsCalls.length} tool call(s) with malformed args: ${names} (${state.emptyArgsCount}/${MAX_EMPTY_ARGS_ITERATIONS})`
      );

      return {
        action: 'continue',
        injectMessage: `Your tool call to ${names} had malformed arguments (null or non-object) and was not executed. Check the tool schema and provide a valid JSON object — use {} for zero-arg tools, or fill in the required parameters for others.`,
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
      if (isEmptyArgs(ctx.currentToolCall.input)) {
        return {
          action: 'skip',
          reason: `Tool call "${ctx.currentToolCall.name}" has malformed arguments (null or non-object).`,
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
