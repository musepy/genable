import { describe, it, expect, vi } from 'vitest';
import { HookRegistry } from '../hooks/hookRegistry';
import { HookRunner } from '../hooks/hookRunner';
import { HookRegistration, HookContext, HookResult } from '../hooks/hookTypes';
import { createBuiltinHooks, createBuiltinHooksWithState } from '../hooks/builtinHooks';
import { createEmptyArgsGuard } from '../hooks/emptyArgsGuard';
import { createConsecutiveFailureGuard } from '../hooks/consecutiveFailureGuard';
import { createPartialFailureGuard } from '../hooks/partialFailureGuard';
import { createBudgetGuard } from '../hooks/budgetGuard';
import { createTruncationPlaceholderGuard, __test__ as truncPlaceholderTest } from '../hooks/truncationPlaceholderGuard';

// ─── Helpers ──────────────────────────────────────────────────

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    iteration: 0,
    maxIterations: 10,
    messages: [],
    loopPolicy: {
      monotoneLoopThreshold: 8,
      maxOutputTokens: 16384,
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

  it('emits trigger_fired event when a hook injects a hint', async () => {
    // Observability: downstream tooling (dev-bridge analysis) should be able
    // to count hook activations without parsing the injected message stream.
    const registry = new HookRegistry();
    const emitted: any[] = [];
    registry.register({
      id: 'hinter',
      event: 'afterToolExec',
      priority: 10,
      fn: async () => ({ action: 'continue', injectMessage: 'retry please' }),
    });

    const runner = new HookRunner(registry, (e) => emitted.push(e));
    await runner.run('afterToolExec', makeCtx());
    const fires = emitted.filter((e) => e.type === 'trigger_fired');
    expect(fires).toHaveLength(1);
    expect(fires[0]).toEqual(
      expect.objectContaining({
        hookId: 'hinter',
        event: 'afterToolExec',
        action: 'continue',
        injected: true,
      }),
    );
  });

  it('emits trigger_fired with code on skip rejects', async () => {
    const registry = new HookRegistry();
    const emitted: any[] = [];
    registry.register({
      id: 'capper',
      event: 'beforeToolExec',
      priority: 10,
      fn: async () => ({ action: 'skip', reason: 'too big', code: 'CAP_REJECT' }),
    });

    const runner = new HookRunner(registry, (e) => emitted.push(e));
    const result = await runner.run('beforeToolExec', makeCtx());
    expect(result.action).toBe('skip');
    expect(result.code).toBe('CAP_REJECT');

    const fires = emitted.filter((e) => e.type === 'trigger_fired');
    expect(fires).toHaveLength(1);
    expect(fires[0]).toEqual(
      expect.objectContaining({
        hookId: 'capper',
        action: 'skip',
        code: 'CAP_REJECT',
        injected: false,
      }),
    );
  });

  it('does not emit trigger_fired on plain continue (no hint, no skip)', async () => {
    const registry = new HookRegistry();
    const emitted: any[] = [];
    registry.register({
      id: 'noop',
      event: 'afterToolExec',
      priority: 10,
      fn: async () => ({ action: 'continue' }),
    });

    const runner = new HookRunner(registry, (e) => emitted.push(e));
    await runner.run('afterToolExec', makeCtx());
    expect(emitted.filter((e) => e.type === 'trigger_fired')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Builtin Hooks
// ═══════════════════════════════════════════════════════════════

describe('createBuiltinHooks', () => {
  it('should create 1 builtin hook registration (loopDetection only)', () => {
    // Empty-response handling moved to provider layer (throws EmptyResponseError).
    // createBuiltinHooks now returns only loopDetection.
    const hooks = createBuiltinHooks();
    expect(hooks).toHaveLength(1);
    expect(hooks.map(h => h.id)).toEqual(['builtin:loopDetection']);
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
    // 1 loopDetection
    // + emptyArgsGuard(2: counter + skip)
    // + consecutiveFailure(1) + partialFailure(1) + budget(1) + stepWarning(1)
    // + inspectGate(2: gate + dirty) + inspectStub(1)
    // + toolPlanTriggers(5: jsxMarkupSize, jsxNodeCount, editUnknownId, knownIdObserver, deleteRebuild)
    // = 15
    expect(hooks).toHaveLength(15);
    expect(typeof reset).toBe('function');
    // reset should not throw
    reset();
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
      toolCalls: [{ type: 'tool_call', id: '1', name: 'createNode', input: { name: 'test' } }],
    });
    const result = await runner.run('afterLLMResponse', ctx);
    expect(result.action).toBe('continue');
  });
});

// ═══════════════════════════════════════════════════════════════
// Guard hooks (Wave 2 migration)
// ═══════════════════════════════════════════════════════════════

describe('emptyArgsGuard', () => {
  it('should abort after repeated empty-args iterations', async () => {
    const guard = createEmptyArgsGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    const emptyToolCalls = [{ type: 'tool_call', id: '1', name: 'run', input: null as any }];

    // Iterations 1-3: continue with injected message
    for (let i = 0; i < 3; i++) {
      const ctx = makeCtx({ toolCalls: emptyToolCalls });
      const result = await runner.run('afterLLMResponse', ctx);
      expect(result.action).toBe('continue');
      expect(ctx.messages.length).toBeGreaterThan(0);
    }

    // Iteration 4: abort
    const ctx = makeCtx({ toolCalls: emptyToolCalls });
    const result = await runner.run('afterLLMResponse', ctx);
    expect(result.action).toBe('abort');
  });

  it('should reset count on valid args', async () => {
    const guard = createEmptyArgsGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    // 2 empty iterations
    for (let i = 0; i < 2; i++) {
      await runner.run('afterLLMResponse', makeCtx({ toolCalls: [{ type: 'tool_call', id: '1', name: 'run', input: null as any }] }));
    }

    // Valid args → reset
    await runner.run('afterLLMResponse', makeCtx({ toolCalls: [{ type: 'tool_call', id: '1', name: 'run', input: { command: 'ls /' } }] }));

    // 3 more empty → should NOT abort (count was reset)
    for (let i = 0; i < 3; i++) {
      const result = await runner.run('afterLLMResponse', makeCtx({ toolCalls: [{ type: 'tool_call', id: '1', name: 'run', input: null as any }] }));
      expect(result.action).toBe('continue');
    }
  });

  it('should skip tool calls with null args in beforeToolExec', async () => {
    const guard = createEmptyArgsGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    const ctx = makeCtx({ currentToolCall: { type: 'tool_call', id: '1', name: 'run', input: null as any } });
    const result = await runner.run('beforeToolExec', ctx);
    expect(result.action).toBe('skip');
  });

  it('should allow empty object {} as valid zero-arg call', async () => {
    const guard = createEmptyArgsGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    // e.g. list_variables() compiles to input: {} — valid per its schema
    const ctx = makeCtx({ currentToolCall: { type: 'tool_call', id: '1', name: 'list_variables', input: {} } });
    const result = await runner.run('beforeToolExec', ctx);
    expect(result.action).toBe('continue');
  });
});

describe('consecutiveFailureGuard', () => {
  it('should inject strategy change after threshold consecutive failures', async () => {
    const guard = createConsecutiveFailureGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    const failResults = [{ toolCall: { type: 'tool_call', id: '1', name: 'run', input: {} }, result: { error: 'failed' } }];

    // 2 failures → no message (threshold is 3)
    for (let i = 0; i < 2; i++) {
      const result = await runner.run('afterIteration', makeCtx({ iterationToolResults: failResults }));
      expect(result.action).toBe('continue');
      expect(result.injectMessage).toBeUndefined();
    }

    // 3rd failure → inject message into ctx.messages
    const ctx3 = makeCtx({ iterationToolResults: failResults });
    const result = await runner.run('afterIteration', ctx3);
    expect(result.action).toBe('continue');
    const injected = ctx3.messages.find(m => m.content?.toString().includes('consecutive iterations have ALL failed'));
    expect(injected).toBeTruthy();
  });

  it('should reset count on successful iteration', async () => {
    const guard = createConsecutiveFailureGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    // 2 failures
    for (let i = 0; i < 2; i++) {
      await runner.run('afterIteration', makeCtx({
        iterationToolResults: [{ toolCall: { type: 'tool_call', id: '1', name: 'run', input: {} }, result: { error: 'failed' } }],
      }));
    }

    // 1 success → reset
    await runner.run('afterIteration', makeCtx({
      iterationToolResults: [{ toolCall: { type: 'tool_call', id: '1', name: 'run', input: {} }, result: {} }],
    }));

    // 2 more failures → no inject (count reset)
    for (let i = 0; i < 2; i++) {
      const ctx = makeCtx({
        iterationToolResults: [{ toolCall: { type: 'tool_call', id: '1', name: 'run', input: {} }, result: { error: 'failed' } }],
      });
      await runner.run('afterIteration', ctx);
      expect(ctx.messages).toHaveLength(0);
    }
  });
});

describe('partialFailureGuard', () => {
  it('should inject repair message on PARTIAL_FAILURE', async () => {
    const guard = createPartialFailureGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    const ctx = makeCtx({
      iterationToolResults: [{
        toolCall: { type: 'tool_call', id: '1', name: 'jsx', input: {} },
        result: {
          error: 'PARTIAL_FAILURE',
          data: { errors: [{ op: 'create /Card/Title', error: 'Font not found' }] },
        },
      }],
    });
    const result = await runner.run('afterIteration', ctx);
    expect(result.action).toBe('continue');
    const injected = ctx.messages.find(m => m.content?.toString().includes('PARTIAL_FAILURE'));
    expect(injected).toBeTruthy();
    expect(injected!.content).toContain('Font not found');
  });

  it('should not inject when no partial failures', async () => {
    const guard = createPartialFailureGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    const ctx = makeCtx({
      iterationToolResults: [{
        toolCall: { type: 'tool_call', id: '1', name: 'jsx', input: {} },
        result: {},
      }],
    });
    const result = await runner.run('afterIteration', ctx);
    expect(result.action).toBe('continue');
    expect(ctx.messages).toHaveLength(0);
  });
});

describe('budgetGuard', () => {
  it('should inject budget warning at 20% remaining', async () => {
    const guard = createBudgetGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    // maxIterations=10, threshold=ceil(10*0.2)=2
    // Hook sees iteration=7 (0-based), next will be 8, remaining = 10-8 = 2 = threshold
    const ctx = makeCtx({ iteration: 7, maxIterations: 10 });
    const result = await runner.run('afterIteration', ctx);
    expect(result.action).toBe('continue');
    // injectMessage is pushed into ctx.messages by hookRunner (not returned on aggregated)
    const injected = ctx.messages.find(m => m.content?.toString().includes('iterations remaining'));
    expect(injected).toBeTruthy();
  });

  it('should not inject when not at threshold', async () => {
    const guard = createBudgetGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    const ctx = makeCtx({ iteration: 3, maxIterations: 10 });
    const result = await runner.run('afterIteration', ctx);
    expect(result.action).toBe('continue');
    expect(ctx.messages).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// truncationPlaceholderGuard
// ═══════════════════════════════════════════════════════════════

describe('truncationPlaceholderGuard', () => {
  describe('findPlaceholder detector', () => {
    const { findPlaceholder } = truncPlaceholderTest;

    it('detects {…} at a nested object field (Kimi props-compression case)', () => {
      const input = {
        edits: [
          { id: '1:2', props: { fill: '#fff' } },
          { id: '1:3', props: '{…}' },
          { id: '1:4', props: '{…}' },
        ],
      };
      const found = findPlaceholder(input);
      expect(found).toEqual({ path: 'edits[1].props', value: '{…}' });
    });

    it('detects {...} with ASCII dots', () => {
      expect(findPlaceholder({ x: '{...}' })?.value).toBe('{...}');
    });

    it('detects [...] and [...] in array-expected fields', () => {
      expect(findPlaceholder({ children: '[...]' })?.value).toBe('[...]');
      expect(findPlaceholder({ children: '[…]' })?.value).toBe('[…]');
    });

    it('trims whitespace before matching', () => {
      expect(findPlaceholder({ x: '  {…}  ' })?.value).toBe('{…}');
    });

    it('does NOT match bare ellipsis or three dots (ambiguous with real UI text)', () => {
      expect(findPlaceholder({ label: 'Loading...' })).toBeNull();
      expect(findPlaceholder({ label: '...' })).toBeNull();
      expect(findPlaceholder({ label: '…' })).toBeNull();
    });

    it('returns null for a fully legitimate input', () => {
      expect(findPlaceholder({ id: '1:2', props: { fill: '#fff', w: 120 } })).toBeNull();
    });
  });

  it('skips a tool call whose args contain {…}', async () => {
    const guard = createTruncationPlaceholderGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    const ctx = makeCtx({
      currentToolCall: {
        type: 'tool_call', id: '1', name: 'edit',
        input: { edits: [{ id: '1:2', props: '{…}' }] },
      },
    });
    const result = await runner.run('beforeToolExec', ctx);
    expect(result.action).toBe('skip');
    expect(result.code).toBe('TRUNCATION_PLACEHOLDER');
    expect(result.reason).toMatch(/truncation placeholder/);
    expect(result.reason).toMatch(/edits\[0\]\.props/);
  });

  it('lets through a clean tool call', async () => {
    const guard = createTruncationPlaceholderGuard();
    const registry = new HookRegistry();
    registry.registerAll(guard.hooks);
    const runner = new HookRunner(registry);

    const ctx = makeCtx({
      currentToolCall: {
        type: 'tool_call', id: '1', name: 'edit',
        input: { edits: [{ id: '1:2', props: { fill: '#fff' } }] },
      },
    });
    const result = await runner.run('beforeToolExec', ctx);
    expect(result.action).toBe('continue');
  });
});
