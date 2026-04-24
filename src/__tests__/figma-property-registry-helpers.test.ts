/**
 * @file figma-property-registry-helpers.test.ts
 * @description Pure-logic tests for the registry helper module.
 *
 * No figma.* mocks required — the registry is a static TS import.
 */

import { describe, it, expect } from 'vitest';
import { PROPERTY_REGISTRY } from '../constants/figma-property-registry';
import {
  getPropsForFacet,
  getFacetKeys,
  getWritableKeys,
  getBindableKeys,
  getPropertyDef,
} from '../constants/figma-property-registry-helpers';

const VISUAL_ROLE_SET = new Set(['layout', 'fill', 'stroke', 'effect', 'appearance', 'typography']);

describe('getFacetKeys', () => {
  it("FRAME 'visual' matches the legacy VISUAL_ROLES filter (role-based, no facet overrides)", () => {
    const expected = new Set(
      PROPERTY_REGISTRY.FRAME
        .filter((entry) => {
          // Mirror the helper's resolution: facet override wins over role.
          const resolved = entry.facet ?? entry.role;
          return VISUAL_ROLE_SET.has(resolved);
        })
        .map((entry) => entry.key),
    );
    expect(getFacetKeys('FRAME', 'visual')).toEqual(expected);
  });

  it("FRAME 'variables' returns exactly boundVariables + explicitVariableModes", () => {
    expect(getFacetKeys('FRAME', 'variables')).toEqual(
      new Set(['boundVariables', 'explicitVariableModes']),
    );
  });

  it("FRAME 'all' has size equal to PROPERTY_REGISTRY.FRAME.length", () => {
    expect(getFacetKeys('FRAME', 'all').size).toBe(PROPERTY_REGISTRY.FRAME.length);
  });

  it("FRAME 'layout' is non-empty and every returned key has role === 'layout'", () => {
    const keys = getFacetKeys('FRAME', 'layout');
    expect(keys.size).toBeGreaterThan(0);
    const byKey = new Map(PROPERTY_REGISTRY.FRAME.map((e) => [e.key, e]));
    for (const k of keys) {
      const entry = byKey.get(k);
      expect(entry).toBeDefined();
      expect(entry!.role).toBe('layout');
    }
  });

  it("FRAME 'bogus' returns empty set (no throw)", () => {
    expect(getFacetKeys('FRAME', 'bogus')).toEqual(new Set());
  });

  it("UNKNOWN_TYPE 'visual' returns empty set (no throw)", () => {
    expect(getFacetKeys('UNKNOWN_TYPE', 'visual')).toEqual(new Set());
  });
});

describe('getPropsForFacet', () => {
  it("FRAME 'all' preserves registry declaration order", () => {
    const entries = getPropsForFacet('FRAME', 'all');
    expect(entries).toEqual(PROPERTY_REGISTRY.FRAME);
  });

  it('returns empty array for unknown node types', () => {
    expect(getPropsForFacet('UNKNOWN_TYPE', 'visual')).toEqual([]);
  });
});

describe('getWritableKeys', () => {
  const writable = getWritableKeys('FRAME');

  it("does NOT contain 'width' or 'height' (Phase 1: computed post-layout)", () => {
    expect(writable.has('width')).toBe(false);
    expect(writable.has('height')).toBe(false);
  });

  it("does NOT contain 'boundVariables' or 'explicitVariableModes'", () => {
    expect(writable.has('boundVariables')).toBe(false);
    expect(writable.has('explicitVariableModes')).toBe(false);
  });

  it("contains 'paddingLeft', 'itemSpacing', 'cornerRadius', 'layoutMode'", () => {
    expect(writable.has('paddingLeft')).toBe(true);
    expect(writable.has('itemSpacing')).toBe(true);
    expect(writable.has('cornerRadius')).toBe(true);
    expect(writable.has('layoutMode')).toBe(true);
  });

  it('returns empty set for unknown node types', () => {
    expect(getWritableKeys('UNKNOWN_TYPE')).toEqual(new Set());
  });
});

describe('getBindableKeys', () => {
  it("FRAME 'FLOAT' contains padding + itemSpacing + cornerRadius + opacity", () => {
    const keys = getBindableKeys('FRAME', 'FLOAT');
    expect(keys.has('paddingLeft')).toBe(true);
    expect(keys.has('paddingRight')).toBe(true);
    expect(keys.has('paddingTop')).toBe(true);
    expect(keys.has('paddingBottom')).toBe(true);
    expect(keys.has('itemSpacing')).toBe(true);
    expect(keys.has('cornerRadius')).toBe(true);
    expect(keys.has('opacity')).toBe(true);
  });

  it("FRAME 'BOOLEAN' is exactly {'visible'}", () => {
    expect(getBindableKeys('FRAME', 'BOOLEAN')).toEqual(new Set(['visible']));
  });

  it("FRAME 'STRING' is empty (characters is TEXT-only)", () => {
    expect(getBindableKeys('FRAME', 'STRING')).toEqual(new Set());
  });

  it("TEXT 'STRING' contains 'characters'", () => {
    expect(getBindableKeys('TEXT', 'STRING').has('characters')).toBe(true);
  });

  it('FRAME with no varType is the union across all bindable types', () => {
    const any = getBindableKeys('FRAME');
    const floats = getBindableKeys('FRAME', 'FLOAT');
    const booleans = getBindableKeys('FRAME', 'BOOLEAN');
    const strings = getBindableKeys('FRAME', 'STRING');
    const colors = getBindableKeys('FRAME', 'COLOR');
    const expected = new Set<string>();
    for (const s of [floats, booleans, strings, colors]) {
      for (const k of s) expected.add(k);
    }
    expect(any).toEqual(expected);
  });

  it('returns empty set for unknown node types', () => {
    expect(getBindableKeys('UNKNOWN_TYPE', 'FLOAT')).toEqual(new Set());
  });
});

describe('getPropertyDef', () => {
  it("FRAME 'paddingLeft' returns a defined entry with key === 'paddingLeft'", () => {
    const def = getPropertyDef('FRAME', 'paddingLeft');
    expect(def).toBeDefined();
    expect(def!.key).toBe('paddingLeft');
  });

  it("FRAME 'nonexistent' returns undefined", () => {
    expect(getPropertyDef('FRAME', 'nonexistent')).toBeUndefined();
  });

  it("UNKNOWN_TYPE 'paddingLeft' returns undefined", () => {
    expect(getPropertyDef('UNKNOWN_TYPE', 'paddingLeft')).toBeUndefined();
  });
});
