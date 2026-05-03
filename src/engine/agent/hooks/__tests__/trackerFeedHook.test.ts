/**
 * @file trackerFeedHook.test.ts
 * @description Pure unit tests for the centralised tracker-feed hook.
 *
 * Covers the hook itself + the pure ID-extraction helpers it owns.
 */
import { describe, it, expect } from 'vitest';
import { HookContext, HookRegistration, HookResult } from '../hookTypes';
import { createInspectionTracker } from '../inspectionTracker';
import {
  createTrackerFeedHook,
  extractKnownIdsFromResult,
  collectIdsFromInspectTree,
} from '../trackerFeedHook';
import { ToolCallBlock } from '../../../llm-client/providers/types';

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    iteration: 0,
    maxIterations: 20,
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

function call(name: string, input: any): ToolCallBlock {
  return { type: 'tool_call', id: `${name}-1`, name, input };
}

async function invoke(hook: HookRegistration, ctx: HookContext): Promise<HookResult | void> {
  return hook.fn(ctx);
}

// ═══════════════════════════════════════════════════════════════
// Pure helpers
// ═══════════════════════════════════════════════════════════════

describe('collectIdsFromInspectTree', () => {
  it('recurses children and gathers all ids', () => {
    const ids = collectIdsFromInspectTree({
      id: 'a',
      children: [
        { id: 'b', children: [{ id: 'd' }] },
        { id: 'c' },
      ],
    });
    expect(Array.from(ids).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns empty for null/non-object input', () => {
    expect(collectIdsFromInspectTree(null).size).toBe(0);
    expect(collectIdsFromInspectTree(undefined).size).toBe(0);
    expect(collectIdsFromInspectTree('not-an-object' as any).size).toBe(0);
  });
});

describe('extractKnownIdsFromResult', () => {
  it('jsx: uses createdIds + id', () => {
    const ids = extractKnownIdsFromResult('jsx', {
      data: { id: '1:2', createdIds: ['1:2', '1:3'] },
    });
    expect(ids).toContain('1:2');
    expect(ids).toContain('1:3');
  });

  it('inspect: walks tree for ids', () => {
    const ids = extractKnownIdsFromResult('inspect', {
      data: { id: '1:2', children: [{ id: '1:3' }, { id: '1:4', children: [{ id: '1:5' }] }] },
    });
    expect(new Set(ids)).toEqual(new Set(['1:2', '1:3', '1:4', '1:5']));
  });

  it('describe: same shape as inspect', () => {
    const ids = extractKnownIdsFromResult('describe', {
      data: { id: '7:7', children: [{ id: '7:8' }] },
    });
    expect(new Set(ids)).toEqual(new Set(['7:7', '7:8']));
  });

  it('find_nodes: pulls results[].id', () => {
    const ids = extractKnownIdsFromResult('find_nodes', {
      data: { results: [{ id: '1:10' }, { id: '1:11' }], total: 2, truncated: false },
    });
    expect(ids).toEqual(['1:10', '1:11']);
  });

  it('get_selection: pulls selection[].id', () => {
    const ids = extractKnownIdsFromResult('get_selection', {
      data: { selection: [{ id: '2:1' }, { id: '2:2' }], count: 2 },
    });
    expect(ids).toEqual(['2:1', '2:2']);
  });

  it('clone_node: pulls idMap values + createdIds + nodeId', () => {
    const ids = extractKnownIdsFromResult('clone_node', {
      data: {
        idMap: { source: '5:1', clone: '5:2' },
        createdIds: ['5:2', '5:3'],
        nodeId: '5:9',
      },
    });
    expect(new Set(ids)).toEqual(new Set(['5:1', '5:2', '5:3', '5:9']));
  });

  it('returns [] for errored result', () => {
    expect(extractKnownIdsFromResult('jsx', { error: 'bad' })).toEqual([]);
  });

  it('returns [] for missing data', () => {
    expect(extractKnownIdsFromResult('jsx', null)).toEqual([]);
    expect(extractKnownIdsFromResult('jsx', {})).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// Hook integration
// ═══════════════════════════════════════════════════════════════

describe('createTrackerFeedHook', () => {
  it('registers afterToolExec at priority 4 (before observer=5, before gate=20)', () => {
    const tracker = createInspectionTracker();
    const { hooks } = createTrackerFeedHook(tracker);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].event).toBe('afterToolExec');
    expect(hooks[0].priority).toBe(4);
  });

  it('marks IDs from a successful inspect tree result', async () => {
    const tracker = createInspectionTracker();
    const { hooks } = createTrackerFeedHook(tracker);
    await invoke(hooks[0], makeCtx({
      currentToolCall: call('inspect', { node: '1:2' }),
      toolResult: { data: { id: '1:2', children: [{ id: '1:3' }, { id: '1:4' }] } },
    }));
    expect(tracker.isInspected('1:2')).toBe(true);
    expect(tracker.isInspected('1:3')).toBe(true);
    expect(tracker.isInspected('1:4')).toBe(true);
  });

  it('marks IDs from a successful jsx result (createdIds)', async () => {
    const tracker = createInspectionTracker();
    const { hooks } = createTrackerFeedHook(tracker);
    await invoke(hooks[0], makeCtx({
      currentToolCall: call('jsx', { markup: '<frame/>' }),
      toolResult: { data: { id: '8:1', createdIds: ['8:1', '8:2'] } },
    }));
    expect(tracker.isInspected('8:1')).toBe(true);
    expect(tracker.isInspected('8:2')).toBe(true);
  });

  it('marks IDs from find_nodes results', async () => {
    const tracker = createInspectionTracker();
    const { hooks } = createTrackerFeedHook(tracker);
    await invoke(hooks[0], makeCtx({
      currentToolCall: call('find_nodes', { query: 'Card' }),
      toolResult: { data: { results: [{ id: '1:10' }], total: 1, truncated: false } },
    }));
    expect(tracker.isInspected('1:10')).toBe(true);
  });

  it('marks IDs from get_selection results', async () => {
    const tracker = createInspectionTracker();
    const { hooks } = createTrackerFeedHook(tracker);
    await invoke(hooks[0], makeCtx({
      currentToolCall: call('get_selection', {}),
      toolResult: { data: { selection: [{ id: '2:20' }, { id: '2:21' }], count: 2 } },
    }));
    expect(tracker.isInspected('2:20')).toBe(true);
    expect(tracker.isInspected('2:21')).toBe(true);
  });

  it('marks clone_node idMap values', async () => {
    const tracker = createInspectionTracker();
    const { hooks } = createTrackerFeedHook(tracker);
    await invoke(hooks[0], makeCtx({
      currentToolCall: call('clone_node', { node: '5:1' }),
      toolResult: { data: { idMap: { source: '5:1', clone: '5:2' } } },
    }));
    expect(tracker.isInspected('5:1')).toBe(true);
    expect(tracker.isInspected('5:2')).toBe(true);
  });

  it('does not mark IDs on errored result', async () => {
    const tracker = createInspectionTracker();
    const { hooks } = createTrackerFeedHook(tracker);
    await invoke(hooks[0], makeCtx({
      currentToolCall: call('inspect', { node: '1:2' }),
      toolResult: { error: 'NOT_FOUND' },
    }));
    expect(tracker.isInspected('1:2')).toBe(false);
  });

  it('is a no-op for unrelated tools (e.g. set_fill)', async () => {
    const tracker = createInspectionTracker();
    const { hooks } = createTrackerFeedHook(tracker);
    await invoke(hooks[0], makeCtx({
      currentToolCall: call('set_fill', { node: '1:2', fill: '#000' }),
      toolResult: { data: { id: '1:2' } },
    }));
    // set_fill returns no IDs that we extract — tracker untouched.
    expect(tracker.isInspected('1:2')).toBe(false);
  });
});
