/**
 * @file toolPlanTriggers.test.ts
 * @description Pure unit tests for tool-plan triggers.
 *
 * No figma.* / LLM mocks — these are hook predicates tested against
 * fake HookContext objects.
 */
import { describe, it, expect } from 'vitest';
import { HookContext, HookRegistration, HookResult } from '../../hooks/hookTypes';
import { createTurnState } from '../turnState';
import {
  createJsxNodeCountTrigger,
  createDeleteCallObserver,
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

  // JSX_SUBTREE_NODE_CAP is currently Infinity — the cap is functionally
  // off. These tests exercise the gate's plumbing only (it should never
  // reject under the current threshold). Restore the count-based assertions
  // if the cap is lowered again.
  it('does not reject any markup count under current cap', async () => {
    const markup = '<frame/>'.repeat(200);
    const ctx = makeCtx({ currentToolCall: call('jsx', { markup }) });
    const result = await invoke(trigger, ctx);
    expect(result).toBeUndefined();
  });

  it('ignores non-jsx tools', async () => {
    const ctx = makeCtx({ currentToolCall: call('edit', { node: '1:2' }) });
    const result = await invoke(trigger, ctx);
    expect(result).toBeUndefined();
  });

  // Sanity: the constants exist and are exported as expected
  it('exports the JSX_SUBTREE_NODE_CAP and CAP_REJECT_CODE constants', () => {
    expect(typeof JSX_SUBTREE_NODE_CAP).toBe('number');
    expect(CAP_REJECT_CODE).toBe('CAP_REJECT');
  });
});

// ═══════════════════════════════════════════════════════════════
// Delete-call observer — records delete_node into recentToolCalls
// ═══════════════════════════════════════════════════════════════

describe('deleteCallObserver', () => {
  it('records delete_node into recentToolCalls with parentHint', async () => {
    const state = createTurnState();
    const observer = createDeleteCallObserver(state);
    await invoke(observer, makeCtx({
      currentToolCall: call('delete_node', { node: '1:2' }),
      toolResult: { data: {} },
    }));
    expect(state.recentToolCalls).toHaveLength(1);
    expect(state.recentToolCalls[0].name).toBe('delete_node');
    expect(state.recentToolCalls[0].parentHint).toBe('1:2');
  });

  it('does not record non-delete tool calls', async () => {
    const state = createTurnState();
    const observer = createDeleteCallObserver(state);
    await invoke(observer, makeCtx({
      currentToolCall: call('inspect', { node: '1:2' }),
      toolResult: { data: { id: '1:2' } },
    }));
    expect(state.recentToolCalls).toHaveLength(0);
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
    const observer = createDeleteCallObserver(state);
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
    const observer = createDeleteCallObserver(state);
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
    const observer = createDeleteCallObserver(state);
    const trigger = createDeleteRebuildTrigger(state);

    // delete
    await invoke(
      observer,
      makeCtx({
        currentToolCall: call('delete_node', { node: '1:100' }),
        toolResult: { data: {} },
      }),
    );
    // 3 jsx calls (each push themselves; combined with the prior delete this
    // walks the delete out of the look-back window of 3)
    for (let i = 0; i < 3; i++) {
      await invoke(
        trigger,
        makeCtx({
          currentToolCall: call('jsx', { markup: '<frame/>' }),
          toolResult: { data: { id: `9:${i}`, createdIds: [`9:${i}`] } },
        }),
      );
    }
    // Final jsx — delete should be far behind the last 3 calls
    // (the last 3 are jsx[9:0], jsx[9:1], jsx[9:2])
    const result = await invoke(
      trigger,
      makeCtx({
        currentToolCall: call('jsx', { markup: '<frame/>' }),
        toolResult: { data: { id: '99:200', createdIds: ['99:200'] } },
      }),
    );
    expect(result).toBeUndefined();
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
    const observer = createDeleteCallObserver(state);
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
// turnState helpers (post-refactor: only recordCall + reset)
// ═══════════════════════════════════════════════════════════════

describe('turnState helpers', () => {
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

  it('reset clears recent calls', () => {
    const state = createTurnState();
    state.recordCall({ type: 'tool_call', id: 'x', name: 'delete_node', input: {} });
    expect(state.recentToolCalls.length).toBe(1);
    state.reset();
    expect(state.recentToolCalls.length).toBe(0);
  });
});
