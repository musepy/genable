/**
 * @file inspectionGate.test.ts
 * @description Unit tests for the inspect-before-mutate gate system.
 *
 * Tests pure logic only: inspectionTracker, inspectGateHook, inspectStubHook.
 * No Figma API, no LLM dependencies.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createInspectionTracker, InspectionTracker } from '../hooks/inspectionTracker';
import { createInspectGateHook } from '../hooks/inspectGateHook';
import { createInspectStubHook } from '../hooks/inspectStubHook';
import { createBuiltinHooksWithState } from '../hooks/builtinHooks';
import { HookContext } from '../hooks/hookTypes';
import { ToolDefinition } from '../tools/types';

// ── Helpers ──────────────────────────────────────────────────────────

/** Minimal tool defs for testing — only name and mutates matter */
const mockToolDefs: ToolDefinition[] = [
  { name: 'edit', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'set_fill', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'set_text', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'set_stroke', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'set_layout', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'replace_props', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'add_component_prop', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'bind_variable', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'alias_variable', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'set_variable_mode', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'combine_components', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'delete_node', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'move_node', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'clone_node', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'jsx', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'create_instance', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'create_component', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'create_variable', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'inspect', executionStrategy: 'parallel', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'describe', executionStrategy: 'parallel', description: '', parameters: { type: 'object', properties: {} } },
];

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    iteration: 0,
    maxIterations: 20,
    messages: [],
    loopPolicy: {} as any,
    generateId: (prefix: string) => `${prefix}_1`,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// InspectionTracker
// ═══════════════════════════════════════════════════════════════

describe('InspectionTracker', () => {
  let tracker: InspectionTracker;

  beforeEach(() => {
    tracker = createInspectionTracker();
  });

  it('starts empty — unknown node is not inspected', () => {
    expect(tracker.isInspected('1:2')).toBe(false);
  });

  it('markInspected → isInspected returns true', () => {
    tracker.markInspected('1:2');
    expect(tracker.isInspected('1:2')).toBe(true);
  });

  it('"/" is always inspected (exempt)', () => {
    expect(tracker.isInspected('/')).toBe(true);
  });

  it('consumeInspection removes the node (dirty flag)', () => {
    tracker.markInspected('1:2');
    tracker.consumeInspection('1:2');
    expect(tracker.isInspected('1:2')).toBe(false);
  });

  it('reset clears all state', () => {
    tracker.markInspected('1:2');
    tracker.markInspected('3:4');
    tracker.reset();
    expect(tracker.isInspected('1:2')).toBe(false);
    expect(tracker.isInspected('3:4')).toBe(false);
  });

  it('consumeInspection on unknown node is a no-op', () => {
    expect(() => tracker.consumeInspection('999:999')).not.toThrow();
  });

  it('markInspected is idempotent', () => {
    tracker.markInspected('1:2');
    tracker.markInspected('1:2');
    expect(tracker.isInspected('1:2')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// InspectionTracker session lifetime (Apr 2026)
// ═══════════════════════════════════════════════════════════════
// tracker is per-AgentRuntime-instance, NOT per-turn. The per-turn
// reset() in builtinHooks must NOT clear the tracker, otherwise LLM
// loses memory of nodes seen in earlier turns and re-inspect cost
// kicks in (Phase B B3/B4 friction).

describe('InspectionTracker survives turn boundary (per-session scope)', () => {
  it('builtinHooks.reset() does NOT clear tracker', () => {
    const { tracker, reset } = createBuiltinHooksWithState();
    tracker.markInspected('1:2');
    tracker.markInspected('3:4');
    reset(); // simulates turn boundary
    expect(tracker.isInspected('1:2')).toBe(true);
    expect(tracker.isInspected('3:4')).toBe(true);
  });

  it('manual tracker.reset() still works (for new-session use)', () => {
    const { tracker, reset } = createBuiltinHooksWithState();
    tracker.markInspected('1:2');
    reset();
    tracker.reset(); // explicit session reset
    expect(tracker.isInspected('1:2')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// InspectGateHook
// ═══════════════════════════════════════════════════════════════

describe('InspectGateHook', () => {
  let tracker: InspectionTracker;
  let gate: ReturnType<typeof createInspectGateHook>;

  beforeEach(() => {
    tracker = createInspectionTracker();
    gate = createInspectGateHook(tracker, mockToolDefs);
  });

  const findHook = (id: string) => gate.hooks.find(h => h.id === id)!;

  describe('beforeToolExec gate', () => {
    const runGate = (toolName: string, input: any) =>
      findHook('builtin:inspectGate').fn(makeCtx({
        currentToolCall: { type: 'tool_call', id: 'tc_1', name: toolName, input },
      }));

    // ── Unknown ID (hallucinated) ──

    it('rejects set_fill on unknown ID with hallucination message', async () => {
      const result = await runGate('set_fill', { node: '1:2', fill: '#000' });
      expect(result?.action).toBe('skip');
      expect(result?.reason).toContain('1:2');
      expect(result?.reason).toContain('unknown');
      expect(result?.reason).toContain('inspect');
    });

    it('rejects delete_node on unknown ID', async () => {
      const result = await runGate('delete_node', { node: '99:99' });
      expect(result?.action).toBe('skip');
      expect(result?.reason).toContain('99:99');
    });

    it('rejects edit on unknown ID', async () => {
      const result = await runGate('edit', { node: '99:99', props: { w: 100 } });
      expect(result?.action).toBe('skip');
      expect(result?.reason).toContain('99:99');
    });

    // ── Known ID ──

    it('allows delete_node on known id', async () => {
      tracker.markInspected('1:2');
      const result = await runGate('delete_node', { node: '1:2' });
      expect(result).toBeUndefined();
    });

    it('allows move_node on known id', async () => {
      tracker.markInspected('1:2');
      const result = await runGate('move_node', { node: '1:2', parent: '/' });
      expect(result).toBeUndefined();
    });

    it('allows clone_node on known id', async () => {
      tracker.markInspected('1:2');
      const result = await runGate('clone_node', { node: '1:2' });
      expect(result).toBeUndefined();
    });

    it('allows edit on known id', async () => {
      tracker.markInspected('1:2');
      const result = await runGate('edit', { node: '1:2', props: { w: 200 } });
      expect(result).toBeUndefined();
    });

    it('allows set_fill on known id', async () => {
      tracker.markInspected('1:2');
      const result = await runGate('set_fill', { node: '1:2', fill: '#000' });
      expect(result).toBeUndefined();
    });

    it('allows set_text on known id', async () => {
      tracker.markInspected('1:2');
      const result = await runGate('set_text', { node: '1:2', text: 'Hello' });
      expect(result).toBeUndefined();
    });

    // ── Non-mutation + creation tools ──

    it('allows non-mutation tools (inspect, describe) without gating', async () => {
      const result = await runGate('inspect', { node: '1:2' });
      expect(result).toBeUndefined();
    });

    it('exempts jsx (creation tool)', async () => {
      const result = await runGate('jsx', { markup: '<frame name="Card"/>' });
      expect(result).toBeUndefined();
    });

    it('exempts create_instance (creation tool)', async () => {
      const result = await runGate('create_instance', { component: '1:1' });
      expect(result).toBeUndefined();
    });

    it('exempts create_component (creation tool)', async () => {
      const result = await runGate('create_component', { nodes: ['1:2'] });
      expect(result).toBeUndefined();
    });

    it('allows mutation on "/" (always known)', async () => {
      const result = await runGate('delete_node', { node: '/' });
      expect(result).toBeUndefined();
    });

    // ── Batch handling ──

    it('blocks batch edit if ANY node is unknown', async () => {
      tracker.markInspected('1:1');
      // 1:2 not marked → unknown
      const result = await runGate('edit', {
        nodes: [{ node: '1:1', props: {} }, { node: '1:2', props: {} }],
      });
      expect(result?.action).toBe('skip');
      expect(result?.reason).toContain('1:2');
      expect(result?.reason).not.toContain('1:1');
    });

    it('allows batch edit when all nodes are known', async () => {
      tracker.markInspected('1:1');
      tracker.markInspected('1:2');
      const result = await runGate('edit', {
        nodes: [{ node: '1:1', props: {} }, { node: '1:2', props: {} }],
      });
      expect(result).toBeUndefined();
    });

    it('handles batch set_text with unknown node', async () => {
      const result = await runGate('set_text', {
        nodes: [{ node: '5:6', text: 'Hello' }],
      });
      expect(result?.action).toBe('skip');
    });

    it('handles missing input gracefully', async () => {
      const result = await runGate('edit', undefined);
      expect(result).toBeUndefined(); // no node IDs → nothing to gate
    });

    it('combine_components gates all IDs in nodes[] array', async () => {
      tracker.markInspected('1:1');
      const result = await runGate('combine_components', { nodes: ['1:1', '1:2'] });
      expect(result?.action).toBe('skip');
      expect(result?.reason).toContain('1:2');
    });

    // ── jsx createdIds → all become known ──

    it('jsx created nodes are born known — can be edited immediately', async () => {
      // Simulate what collectCreatedNodes does in agentRuntime
      tracker.markInspected('10:1');
      tracker.markInspected('10:2');
      tracker.markInspected('10:3');

      const result = await runGate('edit', { node: '10:2', props: { w: 100 } });
      expect(result).toBeUndefined();
    });
  });

  describe('afterToolExec invalidation (delete-only)', () => {
    const runDirty = (toolName: string, input: any, toolResult: any) =>
      findHook('builtin:inspectGate:dirty').fn(makeCtx({
        currentToolCall: { type: 'tool_call', id: 'tc_1', name: toolName, input },
        toolResult,
      }));

    it('consumes inspection after successful delete_node', async () => {
      tracker.markInspected('1:2');
      await runDirty('delete_node', { node: '1:2' }, { data: { deleted: true } });
      expect(tracker.isInspected('1:2')).toBe(false);
    });

    it('does NOT consume after successful edit (ID still valid)', async () => {
      tracker.markInspected('1:2');
      await runDirty('edit', { node: '1:2', props: { w: 200 } }, { data: { id: '1:2' } });
      expect(tracker.isInspected('1:2')).toBe(true);
    });

    it('does NOT consume after successful set_fill', async () => {
      tracker.markInspected('1:2');
      await runDirty('set_fill', { node: '1:2', fill: '#000' }, { data: { id: '1:2' } });
      expect(tracker.isInspected('1:2')).toBe(true);
    });

    it('does NOT consume after successful set_text', async () => {
      tracker.markInspected('1:2');
      await runDirty('set_text', { node: '1:2', text: 'Hello' }, { data: { id: '1:2' } });
      expect(tracker.isInspected('1:2')).toBe(true);
    });

    it('does NOT consume after successful move_node', async () => {
      tracker.markInspected('1:2');
      await runDirty('move_node', { node: '1:2', parent: '/' }, { data: { id: '1:2' } });
      expect(tracker.isInspected('1:2')).toBe(true);
    });

    it('does NOT consume after successful clone_node (source ID unchanged)', async () => {
      tracker.markInspected('1:2');
      await runDirty('clone_node', { node: '1:2' }, { data: { idMap: {} } });
      expect(tracker.isInspected('1:2')).toBe(true);
    });

    it('does NOT consume batch edit targets', async () => {
      tracker.markInspected('1:1');
      tracker.markInspected('1:2');
      await runDirty('edit', { nodes: [{ node: '1:1' }, { node: '1:2' }] }, { data: {} });
      expect(tracker.isInspected('1:1')).toBe(true);
      expect(tracker.isInspected('1:2')).toBe(true);
    });

    it('preserves inspection on delete error', async () => {
      tracker.markInspected('1:2');
      await runDirty('delete_node', { node: '1:2' }, { error: 'Node not found' });
      expect(tracker.isInspected('1:2')).toBe(true);
    });

    it('ignores non-mutation tools', async () => {
      tracker.markInspected('1:2');
      await runDirty('inspect', { node: '1:2' }, { data: {} });
      expect(tracker.isInspected('1:2')).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// InspectStubHook
// ═══════════════════════════════════════════════════════════════

describe('InspectStubHook', () => {
  let tracker: InspectionTracker;
  let stub: ReturnType<typeof createInspectStubHook>;

  beforeEach(() => {
    tracker = createInspectionTracker();
    stub = createInspectStubHook(tracker);
  });

  const findHook = () => stub.hooks.find(h => h.id === 'builtin:inspectStub')!;

  const runStub = (toolName: string, input: any, toolResult: any) =>
    findHook().fn(makeCtx({
      currentToolCall: { type: 'tool_call', id: 'tc_1', name: toolName, input },
      toolResult,
    }));

  it('passes through first inspect result and marks root as known', async () => {
    const result = await runStub('inspect', { node: '1:2' }, { data: { id: '1:2', name: 'Card', type: 'frame' } });
    expect(result).toBeUndefined(); // pass through
    expect(tracker.isInspected('1:2')).toBe(true);
  });

  it('marks direct children as known after inspect with tree', async () => {
    const toolResult = {
      data: {
        id: '1:2',
        name: 'Card',
        type: 'frame',
        children: [
          { id: '1:3', name: 'Header', type: 'frame' },
          { id: '1:4', name: 'Body', type: 'text' },
        ],
      },
    };
    await runStub('inspect', { node: '1:2' }, toolResult);
    expect(tracker.isInspected('1:2')).toBe(true);
    expect(tracker.isInspected('1:3')).toBe(true);
    expect(tracker.isInspected('1:4')).toBe(true);
  });

  it('marks nested grandchildren as known recursively', async () => {
    const toolResult = {
      data: {
        id: '1:2',
        name: 'Card',
        type: 'frame',
        children: [
          {
            id: '1:3',
            name: 'Header',
            type: 'frame',
            children: [
              { id: '1:5', name: 'Title', type: 'text' },
            ],
          },
        ],
      },
    };
    await runStub('inspect', { node: '1:2' }, toolResult);
    expect(tracker.isInspected('1:5')).toBe(true);
  });

  it('marks page root children as known when inspecting "/"', async () => {
    const toolResult = {
      data: {
        page: 'Page 1',
        count: 2,
        children: [
          { id: '2:1', name: 'Login', type: 'frame' },
          { id: '2:2', name: 'Dashboard', type: 'frame' },
        ],
      },
    };
    await runStub('inspect', { node: '/' }, toolResult);
    expect(tracker.isInspected('/')).toBe(true);
    expect(tracker.isInspected('2:1')).toBe(true);
    expect(tracker.isInspected('2:2')).toBe(true);
  });

  it('replaces identical second inspect with stub', async () => {
    const toolResult = { data: { id: '1:2', name: 'Card', type: 'frame' } };
    await runStub('inspect', { node: '1:2' }, toolResult);

    const result = await runStub('inspect', { node: '1:2' }, toolResult);
    expect(result?.action).toBe('continue');
    expect(result?.modifiedResult?.data?._stub).toBe(true);
    expect(result?.modifiedResult?.data?.message).toContain('unchanged');
  });

  it('passes through changed inspect result', async () => {
    await runStub('inspect', { node: '1:2' }, { data: { id: '1:2', name: 'Card' } });

    const result = await runStub('inspect', { node: '1:2' }, { data: { id: '1:2', name: 'Card', opacity: 0.5 } });
    expect(result).toBeUndefined(); // different data → pass through
  });

  it('does not stub error results and does not mark inspected on error', async () => {
    const result = await runStub('inspect', { node: '1:2' }, { error: 'Node not found' });
    expect(result).toBeUndefined();
    expect(tracker.isInspected('1:2')).toBe(false); // error → not marked
  });

  it('works for describe tool too', async () => {
    const result = await runStub('describe', { node: '1:2' }, { data: { roles: ['card'] } });
    expect(result).toBeUndefined();
    expect(tracker.isInspected('1:2')).toBe(true);
  });

  it('ignores non-read tools', async () => {
    const result = await runStub('edit', { node: '1:2' }, { data: {} });
    expect(result).toBeUndefined();
    expect(tracker.isInspected('1:2')).toBe(false);
  });

  it('reset clears the cache', async () => {
    const toolResult = { data: { id: '1:2', name: 'Card' } };
    await runStub('inspect', { node: '1:2' }, toolResult);

    stub.reset();

    // After reset, same result should pass through (not stubbed)
    const result = await runStub('inspect', { node: '1:2' }, toolResult);
    expect(result).toBeUndefined();
  });
});
