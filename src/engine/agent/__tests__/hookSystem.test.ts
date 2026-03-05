import { describe, it, expect, vi } from 'vitest';
import { HookRegistry } from '../hooks/hookRegistry';
import { HookRunner } from '../hooks/hookRunner';
import { HookRegistration, HookContext, HookResult } from '../hooks/hookTypes';
import { createBuiltinHooks, createBuiltinHooksWithState } from '../hooks/builtinHooks';

// ─── Helpers ──────────────────────────────────────────────────

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    iteration: 0,
    maxIterations: 10,
    messages: [],
    loopPolicy: {
      monotoneLoopThreshold: 8,
      maxOutputTokens: 16384,
      promptBudgetTokens: 8000,
      useSkillSystem: true,
    },
    generateId: (prefix: string) => `${prefix}_test_1`,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// HookRegistry
// ═══════════════════════════════════════════════════════════════

describe('HookRegistry', () => {
  it('should register and retrieve hooks by event', () => {
    const registry = new HookRegistry();
    const hook: HookRegistration = {
      id: 'test-hook',
      event: 'afterLLMResponse',
      priority: 50,
      fn: async () => {},
    };

    registry.register(hook);
    expect(registry.getHooks('afterLLMResponse')).toHaveLength(1);
    expect(registry.getHooks('beforeIteration')).toHaveLength(0);
  });

  it('should sort hooks by priority (ascending)', () => {
    const registry = new HookRegistry();
    registry.register({ id: 'b', event: 'afterLLMResponse', priority: 99, fn: async () => {} });
    registry.register({ id: 'a', event: 'afterLLMResponse', priority: 10, fn: async () => {} });
    registry.register({ id: 'c', event: 'afterLLMResponse', priority: 50, fn: async () => {} });

    const hooks = registry.getHooks('afterLLMResponse');
    expect(hooks.map(h => h.id)).toEqual(['a', 'c', 'b']);
  });

  it('should replace hooks with duplicate id', () => {
    const registry = new HookRegistry();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    registry.register({ id: 'dup', event: 'afterLLMResponse', priority: 10, fn: fn1 });
    registry.register({ id: 'dup', event: 'afterLLMResponse', priority: 20, fn: fn2 });

    const hooks = registry.getHooks('afterLLMResponse');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].fn).toBe(fn2);
  });

  it('should unregister by id', () => {
    const registry = new HookRegistry();
    registry.register({ id: 'removable', event: 'beforeIteration', priority: 10, fn: async () => {} });
    expect(registry.size).toBe(1);

    registry.unregister('removable');
    expect(registry.size).toBe(0);
    expect(registry.getHooks('beforeIteration')).toHaveLength(0);
  });

  it('should clear all hooks', () => {
    const registry = new HookRegistry();
    registry.register({ id: 'a', event: 'afterLLMResponse', priority: 10, fn: async () => {} });
    registry.register({ id: 'b', event: 'beforeIteration', priority: 10, fn: async () => {} });
    expect(registry.size).toBe(2);

    registry.clear();
    expect(registry.size).toBe(0);
  });

  it('should register multiple hooks at once', () => {
    const registry = new HookRegistry();
    registry.registerAll([
      { id: 'a', event: 'afterLLMResponse', priority: 10, fn: async () => {} },
      { id: 'b', event: 'afterLLMResponse', priority: 20, fn: async () => {} },
    ]);
    expect(registry.size).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// HookRunner
// ═══════════════════════════════════════════════════════════════

describe('HookRunner', () => {
  it('should return continue when no hooks registered', async () => {
    const registry = new HookRegistry();
    const runner = new HookRunner(registry);
    const result = await runner.run('afterLLMResponse', makeCtx());
    expect(result.action).toBe('continue');
  });

  it('should execute hooks in priority order', async () => {
    const registry = new HookRegistry();
    const order: string[] = [];

    registry.registerAll([
      { id: 'second', event: 'afterLLMResponse', priority: 20, fn: async () => { order.push('second'); } },
      { id: 'first', event: 'afterLLMResponse', priority: 10, fn: async () => { order.push('first'); } },
      { id: 'third', event: 'afterLLMResponse', priority: 30, fn: async () => { order.push('third'); } },
    ]);

    const runner = new HookRunner(registry);
    await runner.run('afterLLMResponse', makeCtx());
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('should stop on abort and return reason', async () => {
    const registry = new HookRegistry();
    const laterHook = vi.fn();

    registry.registerAll([
      { id: 'aborter', event: 'afterLLMResponse', priority: 10, fn: async () => ({ action: 'abort' as const, reason: 'test abort' }) },
      { id: 'later', event: 'afterLLMResponse', priority: 20, fn: laterHook },
    ]);

    const runner = new HookRunner(registry);
    const result = await runner.run('afterLLMResponse', makeCtx());
    expect(result.action).toBe('abort');
    expect(result.reason).toBe('test abort');
    expect(laterHook).not.toHaveBeenCalled();
  });

  it('should stop on skip', async () => {
    const registry = new HookRegistry();
    const laterHook = vi.fn();

    registry.registerAll([
      { id: 'skipper', event: 'afterLLMResponse', priority: 10, fn: async () => ({ action: 'skip' as const }) },
      { id: 'later', event: 'afterLLMResponse', priority: 20, fn: laterHook },
    ]);

    const runner = new HookRunner(registry);
    const result = await runner.run('afterLLMResponse', makeCtx());
    expect(result.action).toBe('skip');
    expect(laterHook).not.toHaveBeenCalled();
  });

  it('should inject messages into context', async () => {
    const registry = new HookRegistry();
    const messages: any[] = [];
    const ctx = makeCtx({ messages });

    registry.register({
      id: 'injector',
      event: 'afterLLMResponse',
      priority: 10,
      fn: async () => ({ action: 'continue' as const, injectMessage: 'Hello from hook' }),
    });

    const runner = new HookRunner(registry);
    await runner.run('afterLLMResponse', ctx);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(expect.objectContaining({
      role: 'user',
      content: 'Hello from hook',
    }));
  });

  it('should forward modifiedResult (last writer wins)', async () => {
    const registry = new HookRegistry();
    registry.registerAll([
      { id: 'first', event: 'afterToolExec', priority: 10, fn: async () => ({ action: 'continue' as const, modifiedResult: 'first' }) },
      { id: 'second', event: 'afterToolExec', priority: 20, fn: async () => ({ action: 'continue' as const, modifiedResult: 'second' }) },
    ]);

    const runner = new HookRunner(registry);
    const result = await runner.run('afterToolExec', makeCtx());
    expect(result.modifiedResult).toBe('second');
  });

  it('should catch and log hook errors without crashing', async () => {
    const registry = new HookRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registry.registerAll([
      { id: 'thrower', event: 'afterLLMResponse', priority: 10, fn: async () => { throw new Error('boom'); } },
      { id: 'survivor', event: 'afterLLMResponse', priority: 20, fn: async () => ({ action: 'continue' as const }) },
    ]);

    const runner = new HookRunner(registry);
    const result = await runner.run('afterLLMResponse', makeCtx());
    expect(result.action).toBe('continue');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('thrower'), expect.anything());
    warnSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════
// Builtin Hooks
// ═══════════════════════════════════════════════════════════════

describe('createBuiltinHooks', () => {
  it('should create 2 builtin hook registrations', () => {
    const hooks = createBuiltinHooks();
    expect(hooks).toHaveLength(2);
    expect(hooks.map(h => h.id)).toEqual([
      'builtin:emptyResponse',
      'builtin:loopDetection',
    ]);
  });

  it('should all subscribe to afterLLMResponse', () => {
    const hooks = createBuiltinHooks();
    expect(hooks.every(h => h.event === 'afterLLMResponse')).toBe(true);
  });

  it('should be sorted by ascending priority', () => {
    const hooks = createBuiltinHooks();
    for (let i = 1; i < hooks.length; i++) {
      expect(hooks[i].priority).toBeGreaterThanOrEqual(hooks[i - 1].priority);
    }
  });
});

describe('createBuiltinHooksWithState', () => {
  it('should provide a reset function', () => {
    const { hooks, reset } = createBuiltinHooksWithState();
    expect(hooks).toHaveLength(2);
    expect(typeof reset).toBe('function');
    // reset should not throw
    reset();
  });
});

describe('Builtin: emptyResponseHook', () => {
  it('should return skip on first empty response', async () => {
    const { hooks } = createBuiltinHooksWithState();
    const registry = new HookRegistry();
    registry.registerAll(hooks);
    const runner = new HookRunner(registry);

    const ctx = makeCtx({ responseText: '', toolCalls: [] });
    const result = await runner.run('afterLLMResponse', ctx);
    expect(result.action).toBe('skip');
  });

  it('should abort after max empty retries', async () => {
    const { hooks } = createBuiltinHooksWithState();
    const registry = new HookRegistry();
    registry.registerAll(hooks);
    const runner = new HookRunner(registry);

    const ctx = makeCtx({ responseText: '', toolCalls: [] });
    // 3 attempts: skip, skip, abort
    await runner.run('afterLLMResponse', ctx);
    await runner.run('afterLLMResponse', ctx);
    const result = await runner.run('afterLLMResponse', ctx);
    expect(result.action).toBe('abort');
    expect(result.reason).toContain('empty response');
  });
});

describe('Builtin: loopDetectionHook', () => {
  it('should continue when no loop detected', async () => {
    const { hooks } = createBuiltinHooksWithState();
    const registry = new HookRegistry();
    registry.registerAll(hooks);
    const runner = new HookRunner(registry);

    const ctx = makeCtx({
      responseText: 'Some text',
      toolCalls: [{ id: '1', name: 'createNode', args: { name: 'test' } }],
    });
    const result = await runner.run('afterLLMResponse', ctx);
    expect(result.action).toBe('continue');
  });
});
