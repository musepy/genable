/**
 * @file jsHandler.test.ts
 * @description Tests for `handleJs` — focused on the "X is not a function"
 * diagnostic enrichment.
 *
 * Bug context: V8 throws "card.findAllAsync is not a function" when the LLM
 * calls findAllAsync on a FRAME (only available on Page/Document). The raw
 * error gives the LLM zero hint about WHY, so it retries the same call. The
 * fix: detect the pattern, infer receiver type at runtime via
 * figma.getNodeByIdAsync, and emit a structured `data` block plus a
 * remediation `suggestion`.
 *
 * Test strategy: stub `figma.getNodeByIdAsync` so the handler's runtime
 * receiver-type lookup returns the desired node-type shape. We do NOT mock
 * the FunctionConstructor pipeline — we rely on real V8 to throw the real
 * "not a function" error string. That keeps these tests honest about the
 * exact error shape we're parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// figma.* surface needed by handleJs:
//   - getNodeByIdAsync: used both by user code and by the diagnostic's
//     receiver-type inference. We give it a configurable lookup table.
const nodeMap = new Map<string, any>();

function setNode(id: string, node: any) {
  nodeMap.set(id, node);
}

function clearNodes() {
  nodeMap.clear();
}

beforeEach(() => {
  clearNodes();
  vi.stubGlobal('figma', {
    getNodeByIdAsync: vi.fn(async (id: string) => nodeMap.get(id) ?? null),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// SUT — import AFTER mocks.
import { handleJs } from '../jsHandler';

describe('handleJs — "not a function" diagnostic', () => {
  it('surfaces method-not-found diagnostic when js calls .findAllAsync on a Frame node', async () => {
    // Frame-shaped node: has `type='FRAME'`, NO findAllAsync method.
    const frame = {
      id: '1917:7402',
      type: 'FRAME',
      name: 'card',
      children: [],
    };
    setNode('1917:7402', frame);

    const code = `
      var card = await figma.getNodeByIdAsync('1917:7402');
      var icons = await card.findAllAsync(n => n.name && n.name.startsWith('lucide:'));
      return icons.map(n => ({id: n.id, name: n.name, type: n.type}));
    `;

    const response = await handleJs({ code });

    // The error string should be specific about method, receiver type, and remedy.
    expect(response.error).toBeDefined();
    expect(response.error).toContain('findAllAsync');
    expect(response.error).toContain('FRAME');
    expect(response.error).toMatch(/children\.filter|recurse manually/);

    // Structured data block for downstream tooling / clarity.
    const data = response.data as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(data.method).toBe('findAllAsync');
    expect(data.receiver_type).toBe('FRAME');
    expect(data.receiver_expr).toBe('card');
    expect(typeof data.suggestion).toBe('string');
    expect(data.suggestion).toMatch(/Page\/Document/);
    expect(typeof data.original_error).toBe('string');
    expect(data.original_error).toMatch(/is not a function/);
  });

  it("surfaces generic 'not a function' message when method/receiver can't be inferred", async () => {
    // Pathological case: receiver is an arbitrary expression result, no
    // figma.getNodeByIdAsync assignment to mine for type info.
    const code = `
      var x = (5).foo();
      return x;
    `;

    const response = await handleJs({ code });

    expect(response.error).toBeDefined();
    // Method name still extractable from the V8 error ("foo is not a function").
    expect(response.error).toContain('foo');
    // No receiver type was inferable — message should NOT claim a node type.
    expect(response.error).not.toMatch(/node of type/);

    const data = response.data as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(data.method).toBe('foo');
    expect(data.receiver_type).toBeNull();
    expect(typeof data.suggestion).toBe('string');
  });

  it('passes through other errors unchanged (ReferenceError)', async () => {
    // Reference to an undeclared variable — V8 throws ReferenceError, NOT
    // "is not a function". Diagnostic must be a no-op.
    const code = `return totallyUndefinedVariable + 1;`;

    const response = await handleJs({ code });

    expect(response.error).toBeDefined();
    // Should still be the raw V8 message — not our enriched format.
    expect(response.error).toMatch(/totallyUndefinedVariable|is not defined/);
    // No structured data block — diagnostic only fires for "not a function".
    expect(response.data).toBeUndefined();
  });

  it('passes through other errors unchanged (TypeError on null property access)', async () => {
    // Reading a property off null/undefined → TypeError, not "is not a function".
    const code = `var x = null; return x.foo.bar;`;

    const response = await handleJs({ code });

    expect(response.error).toBeDefined();
    // Real V8 message — varies a bit but won't contain "is not a function".
    expect(response.error).not.toMatch(/is not a function/);
    expect(response.data).toBeUndefined();
  });

  it('passes through syntax errors unchanged', async () => {
    // Malformed JS → SyntaxError thrown by FunctionConstructor.
    const code = `var x = ;`;

    const response = await handleJs({ code });

    expect(response.error).toBeDefined();
    // Diagnostic must not pollute syntax-error output.
    expect(response.data).toBeUndefined();
  });

  it('successful js calls return data unchanged (sanity)', async () => {
    const frame = {
      id: '1:5',
      type: 'FRAME',
      name: 'sample',
      children: [{ id: '1:6', type: 'TEXT', name: 'label' }],
    };
    setNode('1:5', frame);

    const code = `
      var n = await figma.getNodeByIdAsync('1:5');
      return { id: n.id, type: n.type, name: n.name };
    `;

    const response = await handleJs({ code });

    expect(response.error).toBeUndefined();
    expect(response.data).toBeDefined();
    const data = response.data as any;
    expect(data.id).toBe('1:5');
    expect(data.type).toBe('FRAME');
    expect(data.name).toBe('sample');
  });

  it('infers receiver type from let/const declarations too', async () => {
    const frame = {
      id: '2:1',
      type: 'INSTANCE',
      name: 'card-instance',
      children: [],
    };
    setNode('2:1', frame);

    const code = `
      const node = await figma.getNodeByIdAsync('2:1');
      return await node.findAllAsync(n => true);
    `;

    const response = await handleJs({ code });

    expect(response.error).toBeDefined();
    const data = response.data as Record<string, unknown>;
    expect(data.method).toBe('findAllAsync');
    expect(data.receiver_type).toBe('INSTANCE');
  });
});
