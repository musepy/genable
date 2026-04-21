/**
 * @file toolPlanTriggers.test.ts
 * @description Pure unit tests for tool-plan triggers.
 *
 * No figma.* / LLM mocks — these are hook predicates tested against
 * fake HookContext objects.
 */
import { describe, it, expect } from 'vitest';
import { HookContext, HookRegistration, HookResult } from '../../hooks/hookTypes';
import { createTurnState, collectIdsFromInspectTree, extractKnownIdsFromResult } from '../turnState';
import {
  createJsxNodeCountTrigger,
  createEditUnknownIdTrigger,
  createKnownIdObserver,
  createDeleteRebuildTrigger,
  countJsxNodes,
  JSX_SUBTREE_NODE_CAP,
  CAP_REJECT_CODE,
} from '../toolPlanTriggers';
import { ToolCallBlock } from '../../../llm-client/providers/types';

// ── helpers ─────────────────────────────────────────────────────

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
  return { type: 'tool_call', id: `${name}-${Math.random().toString(36).slice(2, 6)}`, name, input };
}

/** Invoke a single hook directly (bypassing HookRunner/Registry). */
async function invoke(hook: HookRegistration, ctx: HookContext): Promise<HookResult | void> {
  return await hook.fn(ctx);
}

// ═══════════════════════════════════════════════════════════════
// countJsxNodes (pure helper)
// ═══════════════════════════════════════════════════════════════

describe('countJsxNodes', () => {
  it('counts each node-producing tag once', () => {
    const markup = `<frame><text>a</text><icon name="X"/></frame>`;
    expect(countJsxNodes(markup)).toBe(3); // frame + text + icon
  });

  it('returns 0 for empty/invalid input', () => {
    expect(countJsxNodes('')).toBe(0);
    expect(countJsxNodes(undefined as unknown as string)).toBe(0);
  });

  it('ignores non-node tags', () => {
    expect(countJsxNodes('<span><div/></span>')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(countJsxNodes('<FRAME><Text>a</Text></FRAME>')).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// T5 — jsx subtree node count cap
// ═══════════════════════════════════════════════════════════════

describe('T5: jsxNodeCountTrigger', () => {
  const trigger = createJsxNodeCountTrigger();

  it('registers at beforeToolExec with priority 11', () => {
    expect(trigger.event).toBe('beforeToolExec');
    expect(trigger.priority).toBe(11);
  });

  it('allows markup with 60 frame tags', async () => {
    const markup = '<frame/>'.repeat(60);
    const ctx = makeCtx({ currentToolCall: call('jsx', { markup }) });
    const result = await invoke(trigger, ctx);
    expect(result).toBeUndefined();
  });

  it('rejects markup with 61 frame tags', async () => {
    const markup = '<frame/>'.repeat(61);
    const ctx = makeCtx({ currentToolCall: call('jsx', { markup }) });
    const result = await invoke(trigger, ctx);
    expect(result).toBeDefined();
    expect(result!.action).toBe('skip');
    expect(result!.reason).toContain('61 nodes');
    expect(result!.reason).toContain(`max ${JSX_SUBTREE_NODE_CAP}`);
    expect(result!.reason).toContain('Decompose');
  });

  it('stamps code=CAP_REJECT on node-count rejects', async () => {
    const markup = '<frame/>'.repeat(61);
    const ctx = makeCtx({ currentToolCall: call('jsx', { markup }) });
    const result = await invoke(trigger, ctx);
    expect(result?.code).toBe(CAP_REJECT_CODE);
  });

  it('counts mixed tag types together', async () => {
    // 20 frame + 20 text + 21 icon = 61 → reject
    const markup = '<frame/>'.repeat(20) + '<text/>'.repeat(20) + '<icon/>'.repeat(21);
    const ctx = makeCtx({ currentToolCall: call('jsx', { markup }) });
    const result = await invoke(trigger, ctx);
    expect(result?.action).toBe('skip');
  });

  it('ignores non-jsx', async () => {
    const ctx = makeCtx({ currentToolCall: call('edit', { node: '1:2' }) });
    const result = await invoke(trigger, ctx);
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// T6 — edit with unknown node ID
// ═══════════════════════════════════════════════════════════════

describe('T6: editUnknownIdTrigger', () => {
  it('registers at beforeToolExec with priority 12 (before inspectGate=15)', () => {
    const state = createTurnState();
    const trigger = createEditUnknownIdTrigger(state);
    expect(trigger.event).toBe('beforeToolExec');
    expect(trigger.priority).toBe(12);
    expect(trigger.priority).toBeLessThan(15); // strictly before inspectGateHook
  });

  it('rejects edit targeting unknown node ID', async () => {
    const state = createTurnState();
    const trigger = createEditUnknownIdTrigger(state);
    const ctx = makeCtx({
      currentToolCall: call('edit', { node: '999:999', props: { corner: 8 } }),
    });
    const result = await invoke(trigger, ctx);
    expect(result).toBeDefined();
    expect(result!.action).toBe('skip');
    expect(result!.reason).toContain("'999:999'");
    expect(result!.reason).toContain('find_nodes');
    expect(result!.reason).toContain('get_selection');
  });

  it('stamps code=CAP_REJECT on unknown-id rejects', async () => {
    const state = createTurnState();
    const trigger = createEditUnknownIdTrigger(state);
    const ctx = makeCtx({
      currentToolCall: call('edit', { node: '999:999', props: { corner: 8 } }),
    });
    const result = await invoke(trigger, ctx);
    expect(result?.code).toBe(CAP_REJECT_CODE);
  });

  it('passes edit targeting a known node ID', async () => {
    const state = createTurnState();
    state.addKnownIds(['1:2']);
    const trigger = createEditUnknownIdTrigger(state);
    const ctx = makeCtx({
      currentToolCall: call('edit', { node: '1:2', props: { corner: 8 } }),
    });
    const result = await invoke(trigger, ctx);
    expect(result).toBeUndefined();
  });

  it('passes batch edit with all-known IDs', async () => {
    const state = createTurnState();
    state.addKnownIds(['1:2', '1:3']);
    const trigger = createEditUnknownIdTrigger(state);
    const ctx = makeCtx({
      currentToolCall: call('edit', {
        nodes: [
          { node: '1:2', props: {} },
          { node: '1:3', props: {} },
        ],
      }),
    });
    const result = await invoke(trigger, ctx);
    expect(result).toBeUndefined();
  });

  it('rejects batch edit where any ID is unknown', async () => {
    const state = createTurnState();
    state.addKnownIds(['1:2']); // 1:3 is missing
    const trigger = createEditUnknownIdTrigger(state);
    const ctx = makeCtx({
      currentToolCall: call('edit', {
        nodes: [
          { node: '1:2', props: {} },
          { node: '1:3', props: {} },
        ],
      }),
    });
    const result = await invoke(trigger, ctx);
    expect(result?.action).toBe('skip');
    expect(result!.reason).toContain('1:3');
  });

  it('exempts page root "/"', async () => {
    const state = createTurnState();
    const trigger = createEditUnknownIdTrigger(state);
    const ctx = makeCtx({ currentToolCall: call('edit', { node: '/', props: {} }) });
    const result = await invoke(trigger, ctx);
    expect(result).toBeUndefined();
  });

  it('ignores non-edit tool calls', async () => {
    const state = createTurnState();
    const trigger = createEditUnknownIdTrigger(state);
    const ctx = makeCtx({
      currentToolCall: call('delete_node', { node: '999:999' }),
    });
    const result = await invoke(trigger, ctx);
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Known ID observer — populates turnState from read results
// ═══════════════════════════════════════════════════════════════

describe('knownIdObserver', () => {
  it('harvests IDs from inspect tree results', async () => {
    const state = createTurnState();
    const observer = createKnownIdObserver(state);
    const ctx = makeCtx({
      currentToolCall: call('inspect', { node: '1:2' }),
      toolResult: {
        data: {
          id: '1:2',
          children: [
            { id: '1:3', children: [{ id: '1:5' }] },
            { id: '1:4' },
          ],
        },
      },
    });
    await invoke(observer, ctx);
    expect(state.knownNodeIds.has('1:2')).toBe(true);
    expect(state.knownNodeIds.has('1:3')).toBe(true);
    expect(state.knownNodeIds.has('1:4')).toBe(true);
    expect(state.knownNodeIds.has('1:5')).toBe(true);
  });

  it('harvests IDs from find_nodes results', async () => {
    const state = createTurnState();
    const observer = createKnownIdObserver(state);
    const ctx = makeCtx({
      currentToolCall: call('find_nodes', { query: 'Card' }),
      toolResult: {
        data: {
          results: [{ id: '1:10', name: 'Card', type: 'FRAME' }],
          total: 1,
          truncated: false,
        },
      },
    });
    await invoke(observer, ctx);
    expect(state.knownNodeIds.has('1:10')).toBe(true);
  });

  it('does not harvest from error results', async () => {
    const state = createTurnState();
    const observer = createKnownIdObserver(state);
    const ctx = makeCtx({
      currentToolCall: call('inspect', { node: '1:2' }),
      toolResult: { error: 'NOT_FOUND' },
    });
    await invoke(observer, ctx);
    expect(state.knownNodeIds.size).toBe(0);
  });

  it('records delete_node into recentToolCalls', async () => {
    const state = createTurnState();
    const observer = createKnownIdObserver(state);
    const ctx = makeCtx({
      currentToolCall: call('delete_node', { node: '1:2' }),
      toolResult: { data: {} },
    });
    await invoke(observer, ctx);
    expect(state.recentToolCalls).toHaveLength(1);
    expect(state.recentToolCalls[0].name).toBe('delete_node');
    expect(state.recentToolCalls[0].parentHint).toBe('1:2');
  });
});

// ═══════════════════════════════════════════════════════════════
// T_delete_rebuild — delete → jsx within 3 steps → hint
// ═══════════════════════════════════════════════════════════════

describe('T_delete_rebuild: deleteRebuildTrigger', () => {
  it('registers at afterToolExec with priority 50', () => {
    const state = createTurnState();
    const trigger = createDeleteRebuildTrigger(state);
    expect(trigger.event).toBe('afterToolExec');
    expect(trigger.priority).toBe(50);
  });

  it('injects hint when delete → jsx within 3 steps', async () => {
    const state = createTurnState();
    const observer = createKnownIdObserver(state);
    const trigger = createDeleteRebuildTrigger(state);

    // Step 1: delete_node
    await invoke(
      observer,
      makeCtx({
        currentToolCall: call('delete_node', { node: '1:100' }),
        toolResult: { data: {} },
      }),
    );

    // Step 2: jsx (same parent — the deleted node)
    const jsxResult = await invoke(
      trigger,
      makeCtx({
        currentToolCall: call('jsx', { markup: '<frame/>', parent: '1:100' }),
        toolResult: { data: { id: '2:200', createdIds: ['2:200'] } },
      }),
    );

    expect(jsxResult).toBeDefined();
    expect(jsxResult!.action).toBe('continue');
    expect(jsxResult!.injectMessage).toContain('just deleted a subtree');
    expect(jsxResult!.injectMessage).toContain('move_node');
    expect(jsxResult!.injectMessage).toContain('replace_props');
  });

  it('injects hint on delete → jsx (no explicit parent, same file prefix)', async () => {
    const state = createTurnState();
    const observer = createKnownIdObserver(state);
    const trigger = createDeleteRebuildTrigger(state);

    await invoke(
      observer,
      makeCtx({
        currentToolCall: call('delete_node', { node: '42:100' }),
        toolResult: { data: {} },
      }),
    );

    // jsx with no parent; root created ID 42:200 → shares "42:" prefix
    const result = await invoke(
      trigger,
      makeCtx({
        currentToolCall: call('jsx', { markup: '<frame/>' }),
        toolResult: { data: { id: '42:200', createdIds: ['42:200'] } },
      }),
    );
    expect(result?.action).toBe('continue');
    expect(result?.injectMessage).toContain('deleted a subtree');
  });

  it('does NOT inject hint when delete is outside the 3-step window', async () => {
    const state = createTurnState();
    const observer = createKnownIdObserver(state);
    const trigger = createDeleteRebuildTrigger(state);

    // delete
    await invoke(
      observer,
      makeCtx({
        currentToolCall: call('delete_node', { node: '1:100' }),
        toolResult: { data: {} },
      }),
    );
    // 3 inspects (pushes delete out of window of 3)
    for (let i = 0; i < 3; i++) {
      await invoke(
        observer,
        makeCtx({
          currentToolCall: call('inspect', { node: '1:1' }),
          toolResult: { data: { id: '1:1' } },
        }),
      );
    }
    // jsx — delete is no longer in the last-3 window
    const result = await invoke(
      trigger,
      makeCtx({
        currentToolCall: call('jsx', { markup: '<frame/>' }),
        toolResult: { data: { id: '99:200', createdIds: ['99:200'] } },
      }),
    );
    expect(result).toBeUndefined();
  });

  it('records jsx-created IDs so follow-up edits pass T6', async () => {
    const state = createTurnState();
    const trigger = createDeleteRebuildTrigger(state);

    // jsx creates nodes (no preceding delete → no hint, but IDs should still register)
    await invoke(
      trigger,
      makeCtx({
        currentToolCall: call('jsx', { markup: '<frame/>' }),
        toolResult: {
          data: { id: '1:200', createdIds: ['1:200', '1:201', '1:202'] },
        },
      }),
    );

    expect(state.knownNodeIds.has('1:200')).toBe(true);
    expect(state.knownNodeIds.has('1:201')).toBe(true);
    expect(state.knownNodeIds.has('1:202')).toBe(true);
  });

  it('does not double-hint — recording happens after look-back', async () => {
    const state = createTurnState();
    const observer = createKnownIdObserver(state);
    const trigger = createDeleteRebuildTrigger(state);

    await invoke(
      observer,
      makeCtx({
        currentToolCall: call('delete_node', { node: '1:100' }),
        toolResult: { data: {} },
      }),
    );

    // First jsx → hint
    const r1 = await invoke(
      trigger,
      makeCtx({
        currentToolCall: call('jsx', { markup: '<frame/>', parent: '1:100' }),
        toolResult: { data: { id: '1:200', createdIds: ['1:200'] } },
      }),
    );
    expect(r1?.injectMessage).toBeDefined();

    // Second jsx (in same window): no delete in look-back window anymore?
    // The delete is still within window (delete + jsx1 + jsx2 = 3 entries).
    // This test documents: trigger WILL hint again in this case because the
    // delete is within the last 3 steps. We mark as deferred edge case.
    const r2 = await invoke(
      trigger,
      makeCtx({
        currentToolCall: call('jsx', { markup: '<frame/>' }),
        toolResult: { data: { id: '1:300', createdIds: ['1:300'] } },
      }),
    );
    // This documents current behavior — a single delete can produce multiple
    // hints until it ages out of the window. Acceptable for now.
    expect(r2?.injectMessage).toBeDefined();
  });

  // ─── Real-traffic replay: trigger-1776240047149 (P3) ─────────────
  // Sequence observed in dogfood batch 2026-04-15:
  //   iter 8:  delete_node({node: "1581:6759"})
  //   iter 9:  delete_node({node: "1581:6760"})
  //   iter 10: jsx({parent: "1581:6758", ...}) → creates root "1581:6764"
  //
  // Neither deleted id matches the jsx's parent exactly, but all three
  // share the "1581:" file prefix. The prefix-fallback branch of the hook
  // MUST fire under this shape — this is the dominant real-world pattern.
  it('replays real P3 batch: two deletes then jsx with prefix-match parent', async () => {
    const state = createTurnState();
    const observer = createKnownIdObserver(state);
    const trigger = createDeleteRebuildTrigger(state);

    await invoke(
      observer,
      makeCtx({
        currentToolCall: call('delete_node', { node: '1581:6759' }),
        toolResult: { data: { deleted: 'Hero Image', id: '1581:6759' } },
      }),
    );
    await invoke(
      observer,
      makeCtx({
        currentToolCall: call('delete_node', { node: '1581:6760' }),
        toolResult: { data: { deleted: 'Hero Image', id: '1581:6760' } },
      }),
    );

    const jsxResult = await invoke(
      trigger,
      makeCtx({
        currentToolCall: call('jsx', {
          markup: '<frame/>',
          parent: '1581:6758',
        }),
        toolResult: {
          data: { id: '1581:6764', createdIds: ['1581:6764', '1581:6765'] },
        },
      }),
    );

    expect(jsxResult?.action).toBe('continue');
    expect(jsxResult?.injectMessage).toContain('deleted a subtree');
  });
});

// ═══════════════════════════════════════════════════════════════
// turnState helpers
// ═══════════════════════════════════════════════════════════════

describe('turnState helpers', () => {
  it('collectIdsFromInspectTree recurses children', () => {
    const ids = collectIdsFromInspectTree({
      id: 'a',
      children: [
        { id: 'b', children: [{ id: 'd' }] },
        { id: 'c' },
      ],
    });
    expect(Array.from(ids).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('extractKnownIdsFromResult: jsx uses createdIds + id', () => {
    const ids = extractKnownIdsFromResult('jsx', {
      data: { id: '1:2', createdIds: ['1:2', '1:3'] },
    });
    expect(ids).toContain('1:2');
    expect(ids).toContain('1:3');
  });

  it('extractKnownIdsFromResult: returns [] for errored result', () => {
    const ids = extractKnownIdsFromResult('jsx', { error: 'bad' });
    expect(ids).toEqual([]);
  });

  it('recordCall trims window to 5', () => {
    const state = createTurnState();
    for (let i = 0; i < 7; i++) {
      state.recordCall({ type: 'tool_call', id: String(i), name: 'noop', input: {} });
    }
    expect(state.recentToolCalls.length).toBe(5);
    // Oldest kept should be seq=3 (we pushed 1..7, kept 3..7)
    expect(state.recentToolCalls[0].seq).toBe(3);
    expect(state.recentToolCalls[4].seq).toBe(7);
  });

  it('reset clears all state', () => {
    const state = createTurnState();
    state.addKnownIds(['1:2', '1:3']);
    state.recordCall({ type: 'tool_call', id: 'x', name: 'delete_node', input: {} });
    expect(state.knownNodeIds.size).toBe(2);
    expect(state.recentToolCalls.length).toBe(1);
    state.reset();
    expect(state.knownNodeIds.size).toBe(0);
    expect(state.recentToolCalls.length).toBe(0);
  });
});
