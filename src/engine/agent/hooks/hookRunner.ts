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

export class HookRunner {
  constructor(private registry: HookRegistry) {}

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

    for (const hook of hooks) {
      try {
        const result = await hook.fn(ctx);
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

        // Terminal actions: abort or skip → stop running more hooks
        if (result.action === 'abort' || result.action === 'skip') {
          return {
            ...aggregated,
            action: result.action,
            reason: result.reason,
            injectMessage: result.injectMessage,
          };
        }
      } catch (error) {
        // Hook errors are non-fatal — log and continue
        console.warn(`[HookRunner] Hook "${hook.id}" threw an error:`, error);
      }
    }

    return aggregated;
  }
}
