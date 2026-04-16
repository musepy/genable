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
import { HookContext } from '../hooks/hookTypes';
import { ToolDefinition } from '../tools/types';

// ── Helpers ──────────────────────────────────────────────────────────

/** Minimal tool defs for testing — only name and mutates matter */
const mockToolDefs: ToolDefinition[] = [
  { name: 'edit', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'set_fill', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'set_text', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'delete_node', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
  { name: 'jsx', mutates: true, executionStrategy: 'sequential', description: '', parameters: { type: 'object', properties: {} } },
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

    it('skips mutation on uninspected node', async () => {
      const result = await runGate('set_fill', { node: '1:2', fill: '#000' });
      expect(result?.action).toBe('skip');
      expect(result?.reason).toContain('1:2');
      expect(result?.reason).toContain('inspect');
    });

    it('allows mutation on inspected node', async () => {
      tracker.markInspected('1:2');
      const result = await runGate('set_fill', { node: '1:2', fill: '#000' });
      expect(result).toBeUndefined();
    });

    it('allows non-mutation tools (inspect, describe)', async () => {
      const result = await runGate('inspect', { node: '1:2' });
      expect(result).toBeUndefined();
    });

    it('exempts jsx (creation tool)', async () => {
      const result = await runGate('jsx', { markup: '<frame name="Card"/>' });
      expect(result).toBeUndefined();
    });

    it('allows mutation on "/" (always exempt)', async () => {
      const result = await runGate('delete_node', { node: '/' });
      expect(result).toBeUndefined();
    });

    it('blocks batch edit if ANY node uninspected', async () => {
      tracker.markInspected('1:1');
      // 1:2 not inspected
      const result = await runGate('edit', {
        nodes: [{ node: '1:1', props: {} }, { node: '1:2', props: {} }],
      });
      expect(result?.action).toBe('skip');
      expect(result?.reason).toContain('1:2');
      expect(result?.reason).not.toContain('1:1');
    });

    it('allows batch edit when all nodes inspected', async () => {
      tracker.markInspected('1:1');
      tracker.markInspected('1:2');
      const result = await runGate('edit', {
        nodes: [{ node: '1:1', props: {} }, { node: '1:2', props: {} }],
      });
      expect(result).toBeUndefined();
    });

    it('handles batch set_text', async () => {
      const result = await runGate('set_text', {
        nodes: [{ node: '5:6', text: 'Hello' }],
      });
      expect(result?.action).toBe('skip');
    });

    it('handles missing input gracefully', async () => {
      const result = await runGate('edit', undefined);
      expect(result).toBeUndefined(); // no node IDs → nothing to gate
    });
  });

  describe('afterToolExec dirty flag', () => {
    const runDirty = (toolName: string, input: any, toolResult: any) =>
      findHook('builtin:inspectGate:dirty').fn(makeCtx({
        currentToolCall: { type: 'tool_call', id: 'tc_1', name: toolName, input },
        toolResult,
      }));

    it('consumes inspection after successful mutation', async () => {
      tracker.markInspected('1:2');
      expect(tracker.isInspected('1:2')).toBe(true);

      await runDirty('set_fill', { node: '1:2' }, { data: { id: '1:2' } });
      expect(tracker.isInspected('1:2')).toBe(false);
    });

    it('preserves inspection on mutation error', async () => {
      tracker.markInspected('1:2');
      await runDirty('set_fill', { node: '1:2' }, { error: 'Node not found' });
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

  it('passes through first inspect result and marks inspected', async () => {
    const result = await runStub('inspect', { node: '1:2' }, { data: { tree: [{ name: 'Card' }] } });
    expect(result).toBeUndefined(); // pass through
    expect(tracker.isInspected('1:2')).toBe(true);
  });

  it('replaces identical second inspect with stub', async () => {
    const toolResult = { data: { tree: [{ name: 'Card' }] } };
    await runStub('inspect', { node: '1:2' }, toolResult);

    const result = await runStub('inspect', { node: '1:2' }, toolResult);
    expect(result?.action).toBe('continue');
    expect(result?.modifiedResult?.data?._stub).toBe(true);
    expect(result?.modifiedResult?.data?.message).toContain('unchanged');
  });

  it('passes through changed inspect result', async () => {
    await runStub('inspect', { node: '1:2' }, { data: { tree: [{ name: 'Card' }] } });

    const result = await runStub('inspect', { node: '1:2' }, { data: { tree: [{ name: 'Card', bg: '#FFF' }] } });
    expect(result).toBeUndefined(); // different data → pass through
  });

  it('does not stub error results', async () => {
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
    const toolResult = { data: { tree: [{ name: 'Card' }] } };
    await runStub('inspect', { node: '1:2' }, toolResult);

    stub.reset();

    // After reset, same result should pass through (not stubbed)
    const result = await runStub('inspect', { node: '1:2' }, toolResult);
    expect(result).toBeUndefined();
  });
});
