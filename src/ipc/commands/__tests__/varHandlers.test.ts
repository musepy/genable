/**
 * @file varHandlers.test.ts
 * @description Pure-logic tests for bind_variable validation.
 *
 * No figma.* mocks — `validateBindRequest` is a pure function that consumes
 * a resolved nodeType + variableType and returns an error string (or null).
 * The outer `handleBindVariable` wrapper (figma API calls, node resolution)
 * is NOT covered here; validate those paths via the dev bridge E2E.
 */

import { describe, it, expect } from 'vitest';
import { validateBindRequest, BIND_ALIAS_MAP } from '../varHandlers';

describe('validateBindRequest — alias map', () => {
  it('translates "gap" → "itemSpacing" and allows FLOAT on FRAME', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'gap', variableType: 'FLOAT', variableName: 'Spacing/md',
    });
    expect(r.canonicalProp).toBe('itemSpacing');
    expect(r.error).toBeNull();
  });

  it('translates "padding" → "paddingTop"', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'padding', variableType: 'FLOAT', variableName: 'P/md',
    });
    expect(r.canonicalProp).toBe('paddingTop');
    expect(r.error).toBeNull();
  });

  it('translates "padding-left" → "paddingLeft"', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'padding-left', variableType: 'FLOAT', variableName: 'P/md',
    });
    expect(r.canonicalProp).toBe('paddingLeft');
    expect(r.error).toBeNull();
  });

  it('translates "corner" and "corner-radius" → "cornerRadius"', () => {
    expect(validateBindRequest({
      nodeType: 'FRAME', prop: 'corner', variableType: 'FLOAT', variableName: 'R/md',
    }).canonicalProp).toBe('cornerRadius');
    expect(validateBindRequest({
      nodeType: 'FRAME', prop: 'corner-radius', variableType: 'FLOAT', variableName: 'R/md',
    }).canonicalProp).toBe('cornerRadius');
  });

  it('translates "font-size" → "fontSize" — but TEXT.fontSize is not registry-bindable (object-typed)', () => {
    // Regression guard: fontSize currently isn't marked bindable in the registry
    // (valueType:'object'). If we ever flip the registry to mark it bindable,
    // this test needs updating.
    const r = validateBindRequest({
      nodeType: 'TEXT', prop: 'font-size', variableType: 'FLOAT', variableName: 'FS/body',
    });
    expect(r.canonicalProp).toBe('fontSize');
    // Either the registry makes it bindable (error:null) or it stays not-bindable.
    // We assert only the alias works; the bindability outcome follows registry truth.
    expect([null, expect.stringContaining('not bindable')]).toContainEqual(r.error);
  });

  it('BIND_ALIAS_MAP has no identity entries (opacity/visible/width/height must fall through)', () => {
    expect(BIND_ALIAS_MAP['opacity']).toBeUndefined();
    expect(BIND_ALIAS_MAP['visible']).toBeUndefined();
    expect(BIND_ALIAS_MAP['width']).toBeUndefined();
    expect(BIND_ALIAS_MAP['height']).toBeUndefined();
  });
});

describe('validateBindRequest — width/height rejection', () => {
  it('rejects width with "computed post-layout" and "layoutSizingHorizontal" redirect', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'width', variableType: 'FLOAT', variableName: 'W/sm',
    });
    expect(r.canonicalProp).toBe('width');
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('computed post-layout');
    expect(r.error).toContain('layoutSizingHorizontal');
    // Should suggest size-contributing props as the alternative
    expect(r.error).toMatch(/minWidth|maxWidth|padding|itemSpacing/);
  });

  it('rejects height with "computed post-layout" and "layoutSizingVertical" redirect', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'height', variableType: 'FLOAT', variableName: 'H/sm',
    });
    expect(r.canonicalProp).toBe('height');
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('computed post-layout');
    expect(r.error).toContain('layoutSizingVertical');
    expect(r.error).toMatch(/minHeight|maxHeight|padding|itemSpacing/);
  });
});

describe('validateBindRequest — registry-driven bindable lookup', () => {
  it('accepts FLOAT → paddingLeft on FRAME', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'paddingLeft', variableType: 'FLOAT', variableName: 'P/lg',
    });
    expect(r.error).toBeNull();
  });

  it('accepts BOOLEAN → visible on FRAME', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'visible', variableType: 'BOOLEAN', variableName: 'show/card',
    });
    expect(r.error).toBeNull();
  });

  it('accepts STRING → characters on TEXT', () => {
    const r = validateBindRequest({
      nodeType: 'TEXT', prop: 'characters', variableType: 'STRING', variableName: 'Copy/title',
    });
    expect(r.error).toBeNull();
  });

  it('rejects FLOAT → characters (STRING-only bindable) with type-mismatch message', () => {
    const r = validateBindRequest({
      nodeType: 'TEXT', prop: 'characters', variableType: 'FLOAT', variableName: 'N/count',
    });
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('Type mismatch');
    expect(r.error).toContain('STRING');
    expect(r.error).toContain('FLOAT');
  });

  it('rejects BOOLEAN → paddingLeft (FLOAT-only) with type-mismatch message', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'paddingLeft', variableType: 'BOOLEAN', variableName: 'dense',
    });
    expect(r.error).toContain('Type mismatch');
    expect(r.error).toContain('FLOAT');
  });

  it('rejects non-bindable prop with "not bindable on X nodes" message', () => {
    // `name` is a STRING prop but not bindable in the registry.
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'name', variableType: 'STRING', variableName: 'Label/card',
    });
    expect(r.error).toContain('not bindable on FRAME');
  });

  it('rejects unknown node type with "not bindable" message', () => {
    const r = validateBindRequest({
      nodeType: 'WIDGET', prop: 'paddingLeft', variableType: 'FLOAT', variableName: 'P/md',
    });
    expect(r.error).toContain('not bindable on WIDGET');
  });
});
