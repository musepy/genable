/**
 * @file hookRegistry.ts
 * @description Registry for managing hook registrations.
 *
 * Stores hooks keyed by event type, sorted by priority (ascending).
 * Thread-safe for single-threaded JS — mutations are synchronous.
 */

import { HookEvent, HookRegistration } from './hookTypes';

export class HookRegistry {
  private hooks: Map<HookEvent, HookRegistration[]> = new Map();

  /**
   * Register a hook. If a hook with the same id already exists, it is replaced.
   */
  register(reg: HookRegistration): void {
    this.unregister(reg.id); // prevent duplicates
    const list = this.hooks.get(reg.event) || [];
    list.push(reg);
    list.sort((a, b) => a.priority - b.priority);
    this.hooks.set(reg.event, list);
  }

  /**
   * Register multiple hooks at once.
   */
  registerAll(regs: HookRegistration[]): void {
    for (const reg of regs) {
      this.register(reg);
    }
  }

  /**
   * Remove a hook by its unique id (searches all event types).
   */
  unregister(id: string): void {
    for (const [event, list] of this.hooks.entries()) {
      const filtered = list.filter(h => h.id !== id);
      if (filtered.length !== list.length) {
        this.hooks.set(event, filtered);
      }
    }
  }

  /**
   * Get all hooks for a given event, sorted by priority (ascending).
   */
  getHooks(event: HookEvent): HookRegistration[] {
    return this.hooks.get(event) || [];
  }

  /**
   * Remove all registered hooks.
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Total number of registered hooks across all events.
   */
  get size(): number {
    let total = 0;
    for (const list of this.hooks.values()) {
      total += list.length;
    }
    return total;
  }
}
