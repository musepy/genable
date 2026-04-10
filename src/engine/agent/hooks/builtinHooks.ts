/**
 * @file builtinHooks.ts
 * @description Built-in safety-guardrail hooks extracted from AgentRuntime.
 *
 * These hooks replicate the inline safety logic that was previously hard-coded
 * in agentRuntime.ts. They are registered by default unless the caller provides
 * custom hooks.
 *
 * Hooks:
 *  1. emptyResponseHook      — retries on empty LLM responses (afterLLMResponse)
 *  2. loopDetectionHook      — calls LoopDetector on tool calls (afterLLMResponse)
 *  3. emptyArgsGuard         — blocks tool calls with empty args (afterLLMResponse + beforeToolExec)
 *  4. partialFailureGuard    — injects repair directive on PARTIAL_FAILURE (afterIteration)
 *  5. consecutiveFailureGuard— strategy change after N all-fail iterations (afterIteration)
 *  6. budgetGuard            — warns when iteration budget is low (afterIteration)
 */

import { HookRegistration, HookContext, HookResult } from './hookTypes';
import { LoopDetector } from '../loopDetector';
import { buildLoopFingerprint } from '../loopFingerprint';
import { AGENT_RUNTIME_CONSTANTS } from '../constants';
import { createEmptyArgsGuard } from './emptyArgsGuard';
import { createConsecutiveFailureGuard } from './consecutiveFailureGuard';
import { createPartialFailureGuard } from './partialFailureGuard';
import { createBudgetGuard } from './budgetGuard';
import { createStepWarningHook } from './stepWarningHook';

// ---------------------------------------------------------------------------
// Shared state across hook invocations (scoped per createBuiltinHooks call)
// ---------------------------------------------------------------------------

interface BuiltinHookState {
  loopDetector: LoopDetector;
  emptyResponseRetries: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the default set of builtin hooks with fresh internal state.
 * Call once per AgentRuntime instance.
 */
export function createBuiltinHooks(): HookRegistration[] {
  const state: BuiltinHookState = {
    loopDetector: new LoopDetector(),
    emptyResponseRetries: 0,
  };

  return [
    createEmptyResponseHook(state),
    createLoopDetectionHook(state),
  ];
}

// ---------------------------------------------------------------------------
// 1. Empty Response Hook
// ---------------------------------------------------------------------------

function createEmptyResponseHook(state: BuiltinHookState): HookRegistration {
  const MAX_EMPTY_RETRIES = 2;

  return {
    id: 'builtin:emptyResponse',
    event: 'afterLLMResponse',
    priority: 10, // run first — no point checking loops on an empty response
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      const hasToolCalls = ctx.toolCalls && ctx.toolCalls.length > 0;
      const hasText = !!ctx.responseText;

      if (!hasText && !hasToolCalls) {
        state.emptyResponseRetries++;
        if (state.emptyResponseRetries <= MAX_EMPTY_RETRIES) {
          console.warn(`[Hook:emptyResponse] Empty response (retry ${state.emptyResponseRetries}/${MAX_EMPTY_RETRIES})`);
          return { action: 'skip' }; // skip this iteration, retry
        }
        return {
          action: 'abort',
          reason: 'LLM Provider returned an empty response',
        };
      }

      // Reset on non-empty response
      state.emptyResponseRetries = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Loop Detection Hook
// ---------------------------------------------------------------------------

function createLoopDetectionHook(state: BuiltinHookState): HookRegistration {
  return {
    id: 'builtin:loopDetection',
    event: 'afterLLMResponse',
    priority: 30,
    fn: async (ctx: HookContext): Promise<HookResult | void> => {
      if (!ctx.toolCalls || ctx.toolCalls.length === 0) return;

      const fingerprint = buildLoopFingerprint(ctx.toolCalls);
      const loopResult = state.loopDetector.detect(fingerprint, {
        identical: AGENT_RUNTIME_CONSTANTS.LOOP_DETECTION_THRESHOLD,
        monotone: ctx.loopPolicy.monotoneLoopThreshold,
      });

      if (!loopResult) return;

      return {
        action: 'continue',
        injectMessage: loopResult.hint,
      };
    },
  };
}

/**
 * Helper: create new builtin hooks AND return the state for reset control.
 */
export function createBuiltinHooksWithState(): {
  hooks: HookRegistration[];
  reset: () => void;
} {
  const state: BuiltinHookState = {
    loopDetector: new LoopDetector(),
    emptyResponseRetries: 0,
  };

  const emptyArgsGuard = createEmptyArgsGuard();
  const consecutiveFailureGuard = createConsecutiveFailureGuard();
  const partialFailureGuard = createPartialFailureGuard();
  const budgetGuard = createBudgetGuard();
  const stepWarning = createStepWarningHook();

  const hooks = [
    createEmptyResponseHook(state),
    createLoopDetectionHook(state),
    ...emptyArgsGuard.hooks,
    ...consecutiveFailureGuard.hooks,
    ...partialFailureGuard.hooks,
    ...budgetGuard.hooks,
    ...stepWarning.hooks,
  ];

  return {
    hooks,
    reset: () => {
      state.loopDetector.reset();
      state.emptyResponseRetries = 0;
      emptyArgsGuard.reset();
      consecutiveFailureGuard.reset();
      partialFailureGuard.reset();
      budgetGuard.reset();
      stepWarning.reset();
    },
  };
}
