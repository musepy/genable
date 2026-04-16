/**
 * @file hookRunner.ts
 * @description Executes hooks from the registry for a given lifecycle event.
 *
 * Hooks run sequentially in priority order. An `abort` action stops
 * execution of subsequent hooks and propagates upward. A `skip` action
 * stops further hooks for the current event but does not terminate the loop.
 */

import { HookRegistry } from './hookRegistry';
import { HookEvent, HookContext, HookResult } from './hookTypes';

/** Default result when no hooks return anything meaningful. */
const CONTINUE_RESULT: HookResult = { action: 'continue' };

/** Optional callback for runtime event emission (hook errors, performance). */
export type HookEventEmitter = (event: { type: string; [key: string]: any }) => void;

export class HookRunner {
  private emitEvent?: HookEventEmitter;

  constructor(private registry: HookRegistry, emitEvent?: HookEventEmitter) {
    this.emitEvent = emitEvent;
  }

  /**
   * Run all hooks registered for `event` in priority order.
   *
   * - If a hook returns `{ action: 'abort' }`, stop immediately and return it.
   * - If a hook returns `{ action: 'skip' }`, stop immediately and return it.
   * - If a hook returns `{ injectMessage }`, the message is injected into context
   *   before proceeding to the next hook.
   * - If a hook returns `{ modifiedResult }`, it is forwarded (last writer wins).
   * - If a hook returns void/undefined, continue to the next hook.
   */
  async run(event: HookEvent, ctx: HookContext): Promise<HookResult> {
    const hooks = this.registry.getHooks(event);
    if (hooks.length === 0) return CONTINUE_RESULT;

    let aggregated: HookResult = { action: 'continue' };

    const eventStart = Date.now();

    for (const hook of hooks) {
      try {
        const hookStart = Date.now();
        const result = await hook.fn(ctx);
        const hookMs = Date.now() - hookStart;
        if (hookMs > 50) {
          console.warn(`[HookRunner] Slow hook "${hook.id}" on ${event}: ${hookMs}ms`);
        }
        if (!result) continue;

        // Inject message into context immediately so subsequent hooks can see it
        if (result.injectMessage) {
          ctx.messages.push({
            id: ctx.generateId('hook'),
            role: 'user',
            content: result.injectMessage,
          });
        }

        // Carry forward modifiedResult (last writer wins)
        if (result.modifiedResult !== undefined) {
          aggregated.modifiedResult = result.modifiedResult;
        }

        // Observability: emit a trigger_fired event whenever a hook produces
        // a hint or terminates tool execution. Lets dev-bridge consumers see
        // hook activity without parsing message streams.
        if (result.injectMessage || result.action === 'skip' || result.action === 'abort') {
          this.emitEvent?.({
            type: 'trigger_fired',
            hookId: hook.id,
            event,
            action: result.action,
            code: result.code,
            reason: result.reason,
            injected: Boolean(result.injectMessage),
          });
        }

        // Terminal actions: abort or skip → stop running more hooks
        if (result.action === 'abort' || result.action === 'skip') {
          return {
            ...aggregated,
            action: result.action,
            reason: result.reason,
            injectMessage: result.injectMessage,
            code: result.code,
          };
        }
      } catch (error) {
        // Hook errors are non-fatal — log and continue
        console.warn(`[HookRunner] Hook "${hook.id}" threw an error:`, error);
        this.emitEvent?.({
          type: 'hook_error',
          hookId: hook.id,
          event,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const totalMs = Date.now() - eventStart;
    if (totalMs > 100) {
      this.emitEvent?.({
        type: 'hook_perf',
        event,
        hookCount: hooks.length,
        totalMs,
      });
    }

    return aggregated;
  }
}
