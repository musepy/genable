/**
 * @file builtinHooks.ts
 * @description Built-in safety-guardrail hooks extracted from AgentRuntime.
 *
 * These hooks are NOT for error recovery — they are cross-cutting guardrails.
 * Empty / truncated responses are now handled by the provider layer throwing
 * typed `ProviderError`s; runtime surfaces those directly. The old
 * `emptyResponseHook` retry-and-mask layer was deleted in the fail-fast refactor.
 *
 * Hooks:
 *  1. loopDetectionHook       — calls LoopDetector on tool calls (afterLLMResponse)
 *  2. emptyArgsGuard          — blocks tool calls with empty args (afterLLMResponse + beforeToolExec)
 *  3. partialFailureGuard     — injects repair directive on PARTIAL_FAILURE (afterIteration)
 *  4. consecutiveFailureGuard — strategy change after N all-fail iterations (afterIteration)
 *  5. budgetGuard             — warns when iteration budget is low (afterIteration)
 *  6. stepWarning             — warns when steps remaining are low (afterToolExec)
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
  };

  return [
    createLoopDetectionHook(state),
  ];
}

// ---------------------------------------------------------------------------
// 1. Loop Detection Hook
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
  };

  const emptyArgsGuard = createEmptyArgsGuard();
  const consecutiveFailureGuard = createConsecutiveFailureGuard();
  const partialFailureGuard = createPartialFailureGuard();
  const budgetGuard = createBudgetGuard();
  const stepWarning = createStepWarningHook();

  const hooks = [
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
      emptyArgsGuard.reset();
      consecutiveFailureGuard.reset();
      partialFailureGuard.reset();
      budgetGuard.reset();
      stepWarning.reset();
    },
  };
}
