import { describe, it, expect } from 'vitest';
import { validatePostOp, collectTreeViolations, ValidationViolation } from '../postOpValidator';

/**
 * Mock SceneNode factory for testing.
 * Creates minimal Figma node mocks with the properties needed by the validator.
 */
function mockFrame(overrides: Partial<FrameNode> & { children?: any[]; parent?: any } = {}): any {
  return {
    id: 'frame-1',
    name: 'TestFrame',
    type: 'FRAME',
    width: 400,
    height: 300,
    opacity: 1,
    visible: true,
    layoutMode: 'NONE',
    layoutSizingHorizontal: 'FIXED',
    layoutSizingVertical: 'FIXED',
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    itemSpacing: 0,
    children: [],
    parent: null,
    ...overrides,
  };
}

function mockText(overrides: Partial<TextNode> & { parent?: any } = {}): any {
  return {
    id: 'text-1',
    name: 'TestText',
    type: 'TEXT',
    width: 200,
    height: 20,
    opacity: 1,
    visible: true,
    characters: 'Hello',
    fontSize: 14,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    layoutSizingHorizontal: 'FIXED',
    parent: null,
    ...overrides,
  };
}

describe('postOpValidator structured output', () => {

  describe('ValidationViolation structure', () => {
    it('returns ValidationViolation objects with all required fields', () => {
      const node = mockFrame({ width: 0, height: 100 });
      const violations = validatePostOp(node);

      expect(violations.length).toBe(1);
      const a: ValidationViolation = violations[0];

      expect(a).toHaveProperty('code');
      expect(a).toHaveProperty('message');
      expect(a).toHaveProperty('nodeId');
      expect(a).toHaveProperty('nodeName');
      expect(a).toHaveProperty('context');
      expect(a).toHaveProperty('hints');
      expect(typeof a.code).toBe('string');
      expect(typeof a.message).toBe('string');
      expect(typeof a.nodeId).toBe('string');
      expect(typeof a.nodeName).toBe('string');
      expect(typeof a.context).toBe('object');
      expect(Array.isArray(a.hints)).toBe(true);
    });

    it('returns empty array when no issues detected', () => {
      const node = mockFrame({ width: 400, height: 300 });
      const violations = validatePostOp(node);
      expect(violations).toEqual([]);
    });
  });

  describe('ZERO_DIM', () => {
    it('detects zero width with context', () => {
      const node = mockFrame({ id: 'f1', name: 'Card', width: 0, height: 100 });
      const violations = validatePostOp(node);

      expect(violations.length).toBe(1);
      expect(violations[0].code).toBe('ZERO_DIM');
      expect(violations[0].nodeId).toBe('f1');
      expect(violations[0].nodeName).toBe('Card');
      expect(violations[0].context.width).toBe(0);
      expect(violations[0].context.height).toBe(100);
      expect(violations[0].hints.length).toBeGreaterThan(0);
    });

    it('detects zero height', () => {
      const node = mockFrame({ width: 100, height: 0 });
      const violations = validatePostOp(node);
      expect(violations[0].code).toBe('ZERO_DIM');
      expect(violations[0].context.height).toBe(0);
    });
  });

  describe('INVISIBLE', () => {
    it('detects opacity=0 with context', () => {
      const node = mockFrame({ id: 'f2', name: 'Hidden', opacity: 0 });
      const violations = validatePostOp(node);

      expect(violations.length).toBe(1);
      expect(violations[0].code).toBe('INVISIBLE');
      expect(violations[0].context.opacity).toBe(0);
      expect(violations[0].hints.length).toBeGreaterThan(0);
    });
  });

  describe('TEXT_OVERFLOW', () => {
    it('detects text overflow with context and hints', () => {
      const longText = 'A'.repeat(200);
      const node = mockText({
        id: 'txt1',
        name: 'Description',
        characters: longText,
        textAutoResize: 'NONE',
        width: 100,
        height: 20,
        fontSize: 14,
      });
      const violations = validatePostOp(node);

      const overflow = violations.find(a => a.code === 'TEXT_OVERFLOW');
      expect(overflow).toBeDefined();
      expect(overflow!.context.textAutoResize).toBe('NONE');
      expect(overflow!.context.containerWidth).toBe(100);
      expect(overflow!.context.containerHeight).toBe(20);
      expect(overflow!.context.fontSize).toBe(14);
      expect(overflow!.hints.some(h => h.includes('textAutoResize'))).toBe(true);
    });
  });

  describe('TEXT_WRAP_MISSING', () => {
    it('detects missing text wrap on FILL+long text', () => {
      const node = mockText({
        id: 'txt2',
        name: 'LongText',
        characters: 'A'.repeat(80),
        textAutoResize: 'WIDTH_AND_HEIGHT',
        layoutSizingHorizontal: 'FILL',
      });
      const violations = validatePostOp(node);

      const wrap = violations.find(a => a.code === 'TEXT_WRAP_MISSING');
      expect(wrap).toBeDefined();
      expect(wrap!.context.textAutoResize).toBe('WIDTH_AND_HEIGHT');
      expect(wrap!.context.layoutSizingHorizontal).toBe('FILL');
      expect(wrap!.hints[0]).toContain('HEIGHT');
    });
  });

  describe('MISSING_AUTO_LAYOUT', () => {
    it('detects overlapping children without auto-layout', () => {
      const children = [
        { name: 'Child1', type: 'FRAME', x: 0, y: 0, width: 100, height: 50 },
        { name: 'Child2', type: 'FRAME', x: 0, y: 0, width: 100, height: 50 },
      ];
      const node = mockFrame({
        id: 'f3',
        name: 'Container',
        layoutMode: 'NONE',
        children,
      });
      const violations = validatePostOp(node);

      const missing = violations.find(a => a.code === 'MISSING_AUTO_LAYOUT');
      expect(missing).toBeDefined();
      expect(missing!.context.layoutMode).toBe('NONE');
      expect(missing!.context.childCount).toBe(2);
      expect(missing!.hints.some(h => h.includes('VERTICAL'))).toBe(true);
      expect(missing!.hints.some(h => h.includes('HORIZONTAL'))).toBe(true);
    });

    it('does NOT flag frames with auto-layout', () => {
      const children = [
        { name: 'Child1', type: 'FRAME', x: 0, y: 0, width: 100, height: 50 },
        { name: 'Child2', type: 'FRAME', x: 0, y: 50, width: 100, height: 50 },
      ];
      const node = mockFrame({
        layoutMode: 'VERTICAL',
        children,
      });
      const violations = validatePostOp(node);
      expect(violations.find(a => a.code === 'MISSING_AUTO_LAYOUT')).toBeUndefined();
    });
  });

  describe('SIZING_REVERTED', () => {
    it('detects FILL reverted to FIXED with parent context', () => {
      const parent = mockFrame({ id: 'parent-1', name: 'ParentFrame', layoutMode: 'NONE' });
      const node = mockFrame({
        id: 'child-1',
        name: 'ChildFrame',
        layoutSizingHorizontal: 'FIXED',
        parent,
      });

      const violations = validatePostOp(node, { layoutSizingHorizontal: 'FILL' });

      const reverted = violations.find(a => a.code === 'SIZING_REVERTED');
      expect(reverted).toBeDefined();
      expect(reverted!.context.axis).toBe('horizontal');
      expect(reverted!.context.intended).toBe('FILL');
      expect(reverted!.context.actual).toBe('FIXED');
      expect(reverted!.context['parent.layoutMode']).toBe('NONE');
      expect(reverted!.context['parent.name']).toBe('ParentFrame');
      expect(reverted!.hints.some(h => h.includes('layoutMode'))).toBe(true);
    });

    it('provides different hints when parent has auto-layout', () => {
      const parent = mockFrame({ id: 'parent-2', name: 'AutoParent', layoutMode: 'VERTICAL' });
      const node = mockFrame({
        id: 'child-2',
        name: 'ChildFrame',
        layoutSizingHorizontal: 'FIXED',
        parent,
      });

      const violations = validatePostOp(node, { layoutSizingHorizontal: 'FILL' });
      const reverted = violations.find(a => a.code === 'SIZING_REVERTED');
      expect(reverted).toBeDefined();
      // When parent has auto-layout, hint should suggest re-applying FILL, not fixing parent
      expect(reverted!.hints[0]).toContain('FILL');
      expect(reverted!.hints[0]).not.toContain('layoutMode');
    });
  });

  describe('HUG_FILL_CYCLE', () => {
    it('detects HUG parent + FILL child on horizontal axis', () => {
      const children = [
        { id: 'child-1', name: 'FillChild', type: 'FRAME', width: 200, height: 100, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED' },
      ];
      const node = mockFrame({
        id: 'hug-parent',
        name: 'HugParent',
        layoutMode: 'HORIZONTAL',
        layoutSizingHorizontal: 'HUG',
        layoutSizingVertical: 'FIXED',
        children,
      });
      const violations = validatePostOp(node);

      const cycle = violations.find(a => a.code === 'HUG_FILL_CYCLE');
      expect(cycle).toBeDefined();
      expect(cycle!.context.axis).toBe('horizontal');
      expect(cycle!.context.parentSizing).toBe('HUG');
      expect(cycle!.context.childSizing).toBe('FILL');
      expect(cycle!.hints.length).toBeGreaterThan(0);
    });

    it('detects HUG parent + FILL child on vertical axis', () => {
      const children = [
        { id: 'child-2', name: 'FillChild', type: 'FRAME', width: 200, height: 100, layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FILL' },
      ];
      const node = mockFrame({
        id: 'hug-parent-v',
        name: 'HugParentV',
        layoutMode: 'VERTICAL',
        layoutSizingHorizontal: 'FIXED',
        layoutSizingVertical: 'HUG',
        children,
      });
      const violations = validatePostOp(node);

      const cycle = violations.find(a => a.code === 'HUG_FILL_CYCLE');
      expect(cycle).toBeDefined();
      expect(cycle!.context.axis).toBe('vertical');
    });

    it('does NOT flag when parent is FIXED', () => {
      const children = [
        { id: 'child-3', name: 'FillChild', type: 'FRAME', width: 200, height: 100, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED' },
      ];
      const node = mockFrame({
        layoutMode: 'HORIZONTAL',
        layoutSizingHorizontal: 'FIXED',
        layoutSizingVertical: 'FIXED',
        children,
      });
      const violations = validatePostOp(node);
      expect(violations.find(a => a.code === 'HUG_FILL_CYCLE')).toBeUndefined();
    });

    it('does NOT flag when child is HUG (no cycle)', () => {
      const children = [
        { id: 'child-4', name: 'HugChild', type: 'FRAME', width: 200, height: 100, layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'FIXED' },
      ];
      const node = mockFrame({
        layoutMode: 'HORIZONTAL',
        layoutSizingHorizontal: 'HUG',
        layoutSizingVertical: 'FIXED',
        children,
      });
      const violations = validatePostOp(node);
      expect(violations.find(a => a.code === 'HUG_FILL_CYCLE')).toBeUndefined();
    });
  });

  describe('WHITE_ON_WHITE', () => {
    it('detects white stroke on white fill', () => {
      const node = mockFrame({
        id: 'ww-1',
        name: 'WhiteCard',
        fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 } }],
        strokes: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 } }],
      });
      const violations = validatePostOp(node);

      const ww = violations.find(a => a.code === 'WHITE_ON_WHITE');
      expect(ww).toBeDefined();
      expect(ww!.context.fillColor).toBe('#FFFFFF');
      expect(ww!.context.strokeColor).toBe('#FFFFFF');
      expect(ww!.hints.length).toBeGreaterThan(0);
    });

    it('does NOT flag non-white stroke', () => {
      const node = mockFrame({
        fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 } }],
        strokes: [{ type: 'SOLID', visible: true, color: { r: 0.88, g: 0.88, b: 0.88 } }],
      });
      const violations = validatePostOp(node);
      expect(violations.find(a => a.code === 'WHITE_ON_WHITE')).toBeUndefined();
    });

    it('does NOT flag when there are no strokes', () => {
      const node = mockFrame({
        fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 } }],
        strokes: [],
      });
      const violations = validatePostOp(node);
      expect(violations.find(a => a.code === 'WHITE_ON_WHITE')).toBeUndefined();
    });

    it('ignores invisible (visible=false) paints', () => {
      const node = mockFrame({
        fills: [{ type: 'SOLID', visible: false, color: { r: 1, g: 1, b: 1 } }],
        strokes: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 } }],
      });
      const violations = validatePostOp(node);
      expect(violations.find(a => a.code === 'WHITE_ON_WHITE')).toBeUndefined();
    });
  });

  describe('SIBLING_WIDTH_MISMATCH', () => {
    it('detects inconsistent widths in VERTICAL container', () => {
      const children = [
        { id: 'row1', name: 'Row1', type: 'FRAME', width: 300, height: 40, layoutSizingHorizontal: 'FIXED' },
        { id: 'row2', name: 'Row2', type: 'FRAME', width: 250, height: 40, layoutSizingHorizontal: 'FIXED' },
      ];
      const node = mockFrame({
        id: 'table',
        name: 'Table',
        layoutMode: 'VERTICAL',
        children,
      });
      const violations = validatePostOp(node);

      const mismatch = violations.find(a => a.code === 'SIBLING_WIDTH_MISMATCH');
      expect(mismatch).toBeDefined();
      expect(mismatch!.context.childWidths).toEqual([300, 250]);
      expect(mismatch!.hints.some(h => h.includes('FILL'))).toBe(true);
    });
  });

  describe('collectTreeViolations', () => {
    it('returns structured objects for tree walk', () => {
      const child = mockFrame({ id: 'c1', name: 'ZeroChild', width: 0, height: 100 });
      const root = mockFrame({
        id: 'root',
        name: 'Root',
        children: [child],
      });

      const violations = collectTreeViolations(root);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toHaveProperty('code');
      expect(violations[0]).toHaveProperty('context');
      expect(violations[0]).toHaveProperty('hints');
    });

    it('respects maxViolations limit', () => {
      // Create many zero-dim children to trigger multiple violations
      const children = Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        name: `Child${i}`,
        type: 'FRAME',
        width: 0,
        height: 100,
        opacity: 1,
      }));
      const root = mockFrame({ children });

      const violations = collectTreeViolations(root, 5, 3);
      expect(violations.length).toBeLessThanOrEqual(3);
    });
  });
});
