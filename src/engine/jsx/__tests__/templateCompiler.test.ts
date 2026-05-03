/**
 * @file templateCompiler.test.ts
 * @description Tests for JSX compilation and VNode execution.
 *
 * Tests pure logic only — no Figma API dependency.
 * walkTree is tested via E2E (dev bridge), not unit tests.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  compileJsx,
  compileAndExecute,
  preprocessJsx,
  h,
  collectIconNames,
  walkTree,
  type VNode,
  type WalkContext,
} from '../templateCompiler';

// ═══════════════════════════════════════════════════════════════════════════
// preprocessJsx
// ═══════════════════════════════════════════════════════════════════════════

describe('preprocessJsx', () => {
  it('strips markdown code fences', () => {
    const input = '```jsx\n<Frame/>\n```';
    expect(preprocessJsx(input)).toBe('<Frame/>');
  });

  it('strips tsx fences', () => {
    const input = '```tsx\n<Frame/>\n```';
    expect(preprocessJsx(input)).toBe('<Frame/>');
  });

  it('converts set: to __set_', () => {
    expect(preprocessJsx('<Instance set:label="Hi"/>')).toBe(
      '<Instance __set_label="Hi"/>',
    );
  });

  it('converts multiple set: attributes', () => {
    const input = '<Instance set:label="Hi" set:desc="Bye"/>';
    expect(preprocessJsx(input)).toBe(
      '<Instance __set_label="Hi" __set_desc="Bye"/>',
    );
  });

  it('trims whitespace', () => {
    expect(preprocessJsx('  <Frame/>  ')).toBe('<Frame/>');
  });

  it('passes through PascalCase JSX unchanged', () => {
    expect(preprocessJsx('<Frame w={400}/>')).toBe('<Frame w={400}/>');
  });

  it('converts lowercase tags to PascalCase', () => {
    expect(preprocessJsx('<frame w={400}/>')).toBe('<Frame w={400}/>');
    expect(preprocessJsx('<text size={16}>Hello</text>')).toBe(
      '<Text size={16}>Hello</Text>',
    );
  });

  it('converts nested lowercase tags', () => {
    const input = '<frame><text>Hi</text></frame>';
    expect(preprocessJsx(input)).toBe('<Frame><Text>Hi</Text></Frame>');
  });

  it('strips HTML comments', () => {
    expect(preprocessJsx('<Frame><!-- Navbar --></Frame>')).toBe(
      '<Frame></Frame>',
    );
  });

  it('strips multi-line HTML comments', () => {
    const input = '<Frame>\n  <!-- Logo,\n  nav links -->\n</Frame>';
    expect(preprocessJsx(input)).toBe('<Frame>\n  \n</Frame>');
  });

  it('converts all known lowercase tags', () => {
    expect(preprocessJsx('<rect/>')).toBe('<Rect/>');
    expect(preprocessJsx('<ellipse/>')).toBe('<Ellipse/>');
    expect(preprocessJsx('<icon/>')).toBe('<Icon/>');
    expect(preprocessJsx('<image/>')).toBe('<Image/>');
    expect(preprocessJsx('<instance/>')).toBe('<Instance/>');
    expect(preprocessJsx('<component/>')).toBe('<Component/>');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// h() — VNode construction
// ═══════════════════════════════════════════════════════════════════════════

describe('h()', () => {
  it('creates a VNode with type and props', () => {
    const node = h('FRAME', { w: 400 });
    expect(node.type).toBe('FRAME');
    expect(node.props.w).toBe(400);
    expect(node.children).toEqual([]);
  });

  it('handles null props', () => {
    const node = h('TEXT', null);
    expect(node.props).toEqual({});
  });

  it('flattens children', () => {
    const node = h('FRAME', null,
      h('TEXT', null, 'Hello'),
      [h('TEXT', null, 'World')],
    );
    expect(node.children).toHaveLength(2);
  });

  it('filters null/undefined/boolean children', () => {
    const node = h('FRAME', null, null, undefined, false, true, h('TEXT', null));
    expect(node.children).toHaveLength(1);
  });

  it('preserves string children', () => {
    const node = h('TEXT', { fontSize: 24 }, 'Hello World');
    expect(node.children).toEqual(['Hello World']);
  });

  it('handles nested VNode children', () => {
    const child = h('TEXT', null, 'Hello');
    const parent = h('FRAME', null, child);
    expect(parent.children).toHaveLength(1);
    expect((parent.children[0] as VNode).type).toBe('TEXT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// compileJsx
// ═══════════════════════════════════════════════════════════════════════════

describe('compileJsx', () => {
  it('compiles simple self-closing element', () => {
    const result = compileJsx('<Frame w={400}/>');
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('__h');
    expect(result.code).toContain('Frame');
  });

  it('compiles element with string props', () => {
    const result = compileJsx('<Frame name="Card" layout="column"/>');
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('"Card"');
  });

  it('compiles nested elements', () => {
    const result = compileJsx('<Frame><Text>Hello</Text></Frame>');
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('__h');
  });

  it('compiles multi-root (fragment-wrapped)', () => {
    const result = compileJsx('<Frame/>\n<Text>Hi</Text>');
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('__h');
    expect(result.code).toContain('Frame');
    expect(result.code).toContain('Text');
  });

  it('compiles spread props', () => {
    const result = compileJsx('<Frame {...col(16)} {...pad(24)}/>');
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('col');
    expect(result.code).toContain('pad');
  });

  it('compiles function call props', () => {
    const result = compileJsx('<Frame fills={[solid("#FFF")]}/>');
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('solid');
  });

  it('returns error for invalid JSX', () => {
    const result = compileJsx('<Frame <broken/>');
    expect(result.error).toBeDefined();
    expect(result.error!.message).toBeTruthy();
  });

  it('returns error with line number for syntax error', () => {
    const result = compileJsx('<Frame>\n  <Text>Hello\n  <Bad unclosed\n</Frame>');
    expect(result.error).toBeDefined();
    // Line number extraction is best-effort
    if (result.error!.line !== undefined) {
      expect(result.error!.line).toBeGreaterThan(0);
    }
  });

  it('handles set: preprocessing before compile', () => {
    const result = compileJsx('<Instance ref="Button" set:label="Submit"/>');
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('__set_label');
  });

  it('strips markdown fences before compile', () => {
    const result = compileJsx('```jsx\n<Frame/>\n```');
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('__h');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// compileAndExecute — VNode output
// ═══════════════════════════════════════════════════════════════════════════

describe('compileAndExecute', () => {
  it('produces VNode from simple element', async () => {
    const { vnodes, error } = await compileAndExecute('<Frame w={400}/>');
    expect(error).toBeUndefined();
    expect(vnodes).toHaveLength(1);
    expect(vnodes[0].type).toBe('FRAME');
    expect(vnodes[0].props.w).toBe(400);
  });

  it('produces nested VNodes', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame><Text fontSize={24}>Hello</Text></Frame>',
    );
    expect(vnodes).toHaveLength(1);
    expect(vnodes[0].type).toBe('FRAME');
    expect(vnodes[0].children).toHaveLength(1);
    const text = vnodes[0].children[0] as VNode;
    expect(text.type).toBe('TEXT');
    expect(text.props.fontSize).toBe(24);
    expect(text.children).toEqual(['Hello']);
  });

  it('produces multi-root VNodes', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame name="A"/>\n<Frame name="B"/>',
    );
    expect(vnodes).toHaveLength(2);
    expect(vnodes[0].props.name).toBe('A');
    expect(vnodes[1].props.name).toBe('B');
  });

  it('executes template functions in props', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame fills={[solid("#FF0000")]}/>',
    );
    expect(vnodes).toHaveLength(1);
    const fills = vnodes[0].props.fills;
    expect(fills).toHaveLength(1);
    expect(fills[0].type).toBe('SOLID');
    expect(fills[0].color.r).toBeCloseTo(1);
  });

  it('executes spread template functions', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame {...col(16)} {...pad(24)}/>',
    );
    const props = vnodes[0].props;
    expect(props.layoutMode).toBe('VERTICAL');
    expect(props.itemSpacing).toBe(16);
    expect(props.paddingTop).toBe(24);
  });

  it('handles gradient template function', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame fills={[gradient(135, "#667eea", "#764ba2")]}/>',
    );
    const fills = vnodes[0].props.fills;
    expect(fills[0].type).toBe('GRADIENT_LINEAR');
    expect(fills[0].gradientStops).toHaveLength(2);
  });

  it('handles shadow template function', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame effects={[shadow(0, 4, 24, 0, "#0000001A")]}/>',
    );
    const effects = vnodes[0].props.effects;
    expect(effects[0].type).toBe('DROP_SHADOW');
    expect(effects[0].radius).toBe(24);
  });

  it('handles complex real-world example', async () => {
    const jsx = `
      <Frame {...col(16)} {...pad(24)} fills={[solid('#FFFFFF')]} cornerRadius={12}
             effects={[shadow(0, 4, 24, 0, '#0000001A')]}>
        <Text fontSize={24} fontWeight="Bold" fills={[solid('#111827')]}>
          Sign In
        </Text>
        <Frame {...row(8)} {...pad(12)} cornerRadius={8}
               strokes={[solid('#D0D5DD')]} {...fillH()}>
          <Text fontSize={14} fills={[solid('#9CA3AF')]}>
            email@example.com
          </Text>
        </Frame>
      </Frame>
    `;
    const { vnodes, error } = await compileAndExecute(jsx);
    expect(error).toBeUndefined();
    expect(vnodes).toHaveLength(1);

    const root = vnodes[0];
    expect(root.type).toBe('FRAME');
    expect(root.props.layoutMode).toBe('VERTICAL');
    expect(root.props.paddingTop).toBe(24);
    expect(root.children).toHaveLength(2);

    const title = root.children[0] as VNode;
    expect(title.type).toBe('TEXT');
    expect(title.children).toEqual(['Sign In']);

    const input = root.children[1] as VNode;
    expect(input.type).toBe('FRAME');
    expect(input.props.layoutMode).toBe('HORIZONTAL');
    expect(input.props.layoutSizingHorizontal).toBe('FILL');
  });

  it('handles Instance with set: overrides', async () => {
    const { vnodes } = await compileAndExecute(
      '<Instance ref="Button" set:label="Submit"/>',
    );
    expect(vnodes).toHaveLength(1);
    expect(vnodes[0].type).toBe('INSTANCE');
    expect(vnodes[0].props.ref).toBe('Button');
    expect(vnodes[0].props.__set_label).toBe('Submit');
  });

  it('handles Icon element', async () => {
    const { vnodes } = await compileAndExecute(
      '<Icon name="lucide:home" size={24}/>',
    );
    expect(vnodes[0].type).toBe('ICON');
    expect(vnodes[0].props.name).toBe('lucide:home');
    expect(vnodes[0].props.size).toBe(24);
  });

  it('returns compile error for invalid JSX', async () => {
    const { error } = await compileAndExecute('<Frame <broken/>');
    expect(error).toBeDefined();
    expect(error!.code).toBe('COMPILE_ERROR');
  });

  it('returns runtime error for undefined variable', async () => {
    const { error } = await compileAndExecute(
      '<Frame name={undefinedVariable}/>',
    );
    expect(error).toBeDefined();
    expect(error!.code).toBe('RUNTIME_ERROR');
  });

  it('times out on long-running execution', async () => {
    const { error } = await compileAndExecute(
      '<Frame name={await new Promise(() => {})}/>',
      { timeoutMs: 100 },
    );
    expect(error).toBeDefined();
    expect(error!.code).toBe('TIMEOUT');
  }, 5000);

  it('handles empty input', async () => {
    const { vnodes } = await compileAndExecute('');
    expect(vnodes).toHaveLength(0);
  });

  it('handles lowercase tags (backward compat)', async () => {
    const { vnodes } = await compileAndExecute(
      '<frame><text size={16}>Hello</text></frame>',
    );
    expect(vnodes).toHaveLength(1);
    expect(vnodes[0].type).toBe('FRAME');
    const text = vnodes[0].children[0] as VNode;
    expect(text.type).toBe('TEXT');
    expect(text.props.size).toBe(16);
    expect(text.children).toEqual(['Hello']);
  });

  it('handles Rect alias', async () => {
    const { vnodes } = await compileAndExecute('<Rect w={100} h={50}/>');
    expect(vnodes[0].type).toBe('RECTANGLE');
  });

  it('handles deep nesting', async () => {
    const { vnodes } = await compileAndExecute(`
      <Frame name="L1">
        <Frame name="L2">
          <Frame name="L3">
            <Text>Deep</Text>
          </Frame>
        </Frame>
      </Frame>
    `);
    expect(vnodes).toHaveLength(1);
    const l2 = vnodes[0].children[0] as VNode;
    const l3 = l2.children[0] as VNode;
    const text = l3.children[0] as VNode;
    expect(text.type).toBe('TEXT');
    expect(text.children).toEqual(['Deep']);
  });

  it('handles all node type constants', async () => {
    const types = [
      'Frame', 'Text', 'Rect', 'Rectangle', 'Ellipse', 'Line',
      'Vector', 'Group', 'Section', 'Component', 'Icon', 'Image',
    ];
    for (const t of types) {
      const { vnodes, error } = await compileAndExecute(`<${t}/>`);
      expect(error).toBeUndefined();
      expect(vnodes).toHaveLength(1);
    }
  });

  it('handles align shortcut in spread', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame {...row(8)} {...align("center", "center")}/>',
    );
    expect(vnodes[0].props.primaryAxisAlignItems).toBe('CENTER');
    expect(vnodes[0].props.counterAxisAlignItems).toBe('CENTER');
  });

  it('handles sizing shortcuts', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame {...sizeFill()} {...col(0)}/>',
    );
    expect(vnodes[0].props.layoutSizingHorizontal).toBe('FILL');
    expect(vnodes[0].props.layoutSizingVertical).toBe('FILL');
  });

  it('handles blur/bgblur in effects', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame effects={[blur(10), bgblur(20)]}/>',
    );
    const effects = vnodes[0].props.effects;
    expect(effects).toHaveLength(2);
    expect(effects[0].type).toBe('LAYER_BLUR');
    expect(effects[1].type).toBe('BACKGROUND_BLUR');
  });

  it('handles hexToRgb in expressions', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame data={hexToRgb("#FF0000")}/>',
    );
    expect(vnodes[0].props.data.r).toBeCloseTo(1);
  });

  it('handles rgb() in expressions', async () => {
    const { vnodes } = await compileAndExecute(
      '<Frame data={rgb(255, 128, 0)}/>',
    );
    expect(vnodes[0].props.data.r).toBeCloseTo(1);
    expect(vnodes[0].props.data.g).toBeCloseTo(128 / 255);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// collectIconNames
// ═══════════════════════════════════════════════════════════════════════════

describe('collectIconNames', () => {
  it('collects icon names from flat list', () => {
    const vnodes: VNode[] = [
      { type: 'ICON', props: { name: 'lucide:home' }, children: [] },
      { type: 'ICON', props: { icon: 'mdi:star' }, children: [] },
    ];
    expect(collectIconNames(vnodes)).toEqual(['lucide:home', 'mdi:star']);
  });

  it('collects from nested tree', () => {
    const vnodes: VNode[] = [{
      type: 'FRAME', props: {}, children: [
        { type: 'ICON', props: { name: 'lucide:home' }, children: [] },
        {
          type: 'FRAME', props: {}, children: [
            { type: 'ICON', props: { iconName: 'mdi:star' }, children: [] },
          ],
        },
      ],
    }];
    expect(collectIconNames(vnodes)).toEqual(['lucide:home', 'mdi:star']);
  });

  it('returns empty for no icons', () => {
    const vnodes: VNode[] = [
      { type: 'FRAME', props: {}, children: [] },
    ];
    expect(collectIconNames(vnodes)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// walkTree — warning forwarding (Phase 1 strict resolver propagation)
// ═══════════════════════════════════════════════════════════════════════════
//
// Bug context: jsx is the dominant write path (whole-design generation in
// one tool call with N $Token bindings). Before this test, walkTree
// flattened result.warnings to {code, message}, dropping the
// AMBIGUOUS_NAME_AUTOPICK payload (picked_variable_id, candidates) so the
// LLM never received Phase 1 self-correction signals.
//
// We mock the nodeFactory's createFrame to return a NodeResult carrying a
// rich AMBIGUOUS_NAME_AUTOPICK warning, and assert walkTree forwards it
// VERBATIM into ctx.warnings (plus a node_id tag).

vi.mock('../../actions/nodeFactory', async () => {
  const actual = await vi.importActual<typeof import('../../actions/nodeFactory')>(
    '../../actions/nodeFactory',
  );
  return {
    ...actual,
    // Replace createFrame to bypass the real Figma API and inject the
    // warning(s) the handler would have produced. Different vnode props
    // map to different warning shapes so a single mock can drive all the
    // forwarding tests below.
    createFrame: vi.fn(async (_parent: any, props: Record<string, any>) => {
      // `$Surface/Bg` → MISSING_MODE_VALUES (Phase 2 step 4)
      if (props.fills === '$Surface/Bg') {
        return {
          nodeId: 'mock:2',
          warnings: [
            {
              code: 'MISSING_MODE_VALUES',
              severity: 'warning' as const,
              message:
                "Variable VariableID:1:5 (Text/Primary) lacks values for modes: " +
                "['Dark']. Node mock:2 will render in one of these modes via " +
                'mode chain. No binding applied.',
              variable_id: 'VariableID:1:5',
              variable_name: 'Text/Primary',
              collection_id: 'VariableCollectionId:1:1',
              missing_modes: ['Dark'],
            },
          ],
        };
      }
      // Default: AMBIGUOUS_NAME_AUTOPICK (Phase 1 strict resolver)
      return {
        nodeId: 'mock:1',
        warnings: [
          {
            code: 'AMBIGUOUS_NAME_AUTOPICK',
            severity: 'warning' as const,
            message: 'Bare-name lookup found 2 variables.',
            picked_variable_id: 'V1',
            candidates: [
              {
                variable_id: 'V1',
                name: 'Text/Primary',
                collection_id: 'C-old',
                collection_name: 'Old Theme',
                type: 'COLOR',
                mode_coverage: ['Light'],
                source: 'preexisting' as const,
              },
              {
                variable_id: 'V2',
                name: 'Text/Primary',
                collection_id: 'C-new',
                collection_name: 'Finance/Theme',
                type: 'COLOR',
                mode_coverage: ['Light', 'Dark'],
                source: 'preexisting' as const,
              },
            ],
          },
        ],
      };
    }),
    tagAsAgentCreated: vi.fn(),
    normalizeSizingInProps: vi.fn(),
  };
});

// Minimal figma global so walkTree's auxiliary calls don't throw.
vi.stubGlobal('figma', {
  // Just enough to satisfy the post-create lookup + best-effort tag.
  getNodeByIdAsync: vi.fn().mockResolvedValue(null),
});

describe('walkTree — preserves full warning payload (Phase 1 propagation)', () => {
  it('forwards AMBIGUOUS_NAME_AUTOPICK with picked_variable_id, candidates, and node_id intact', async () => {
    const ctx: WalkContext = {
      symbolMap: new Map(),
      rollbackStack: [],
      warnings: [],
      counter: 0,
    };
    const vnode: VNode = {
      type: 'FRAME',
      props: { fills: '$Text/Primary' },
      children: [],
    };

    await walkTree(vnode, null, ctx);

    // The lossy fix would have given us {code, message} only.
    // The new code must carry the full payload PLUS a node_id we just created.
    expect(ctx.warnings).toHaveLength(1);
    const w = ctx.warnings[0] as any;
    expect(w.code).toBe('AMBIGUOUS_NAME_AUTOPICK');
    expect(w.picked_variable_id).toBe('V1');
    expect(w.candidates).toHaveLength(2);
    expect(w.candidates[0]).toMatchObject({
      variable_id: 'V1',
      collection_name: 'Old Theme',
      type: 'COLOR',
    });
    expect(w.candidates[1]).toMatchObject({
      variable_id: 'V2',
      collection_name: 'Finance/Theme',
    });
    // Tagged with the node id created by walkTree.
    expect(w.node_id).toBe('mock:1');
  });

  // ── Phase 2 step 4 — MISSING_MODE_VALUES propagation ──
  //
  // The variableBindingHandler emits this when a $Token resolves to a
  // variable whose valuesByMode lacks the target node's resolved render mode
  // (spec §6.1). walkTree must forward the full payload (variable_id,
  // missing_modes, collection_id) tagged with node_id so jsxHandler can
  // surface it to the LLM via aggregateBindingWarnings.
  it('JSX bare-name binding fails MISSING_MODE_VALUES when variable lacks a mode in node\'s resolved chain', async () => {
    const ctx: WalkContext = {
      symbolMap: new Map(),
      rollbackStack: [],
      warnings: [],
      counter: 0,
    };
    // The createFrame mock above emits MISSING_MODE_VALUES when fills === '$Surface/Bg'.
    const vnode: VNode = {
      type: 'FRAME',
      props: { fills: '$Surface/Bg' },
      children: [],
    };

    await walkTree(vnode, null, ctx);

    // The walk forwards the handler's warning verbatim, only adding a node_id
    // tag — that's the load-bearing contract jsxHandler depends on.
    expect(ctx.warnings).toHaveLength(1);
    const w = ctx.warnings[0] as any;
    expect(w.code).toBe('MISSING_MODE_VALUES');
    expect(w.variable_id).toBe('VariableID:1:5');
    expect(w.variable_name).toBe('Text/Primary');
    expect(w.collection_id).toBe('VariableCollectionId:1:1');
    expect(w.missing_modes).toEqual(['Dark']);
    // node_id was added by walkTree (handler doesn't know it yet) — this is
    // what aggregateBindingWarnings dedups on across multiple binding props.
    expect(w.node_id).toBe('mock:2');
  });
});
