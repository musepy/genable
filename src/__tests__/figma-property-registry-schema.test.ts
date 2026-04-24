/**
 * @file figma-property-registry-schema.test.ts
 * @description Structural invariants on the auto-generated PROPERTY_REGISTRY.
 *
 * These assertions guard the schema additions from Phase 1 of the registry SSOT refactor:
 *   - `writable` field is required (boolean) on every entry
 *   - `bindable` (when present) matches the FLOAT | BOOLEAN | STRING | COLOR union
 *   - `facet` (when present) is a non-empty string
 *   - width/height always non-writable + non-bindable (computed post-layout; Q1 decision)
 *   - boundVariables/explicitVariableModes always facet='variables' (role='computed' override)
 *   - characters on TEXT is bindable='STRING'
 *   - padding/opacity/visible bindings match the audit whitelist
 *
 * Pure-logic test — the registry is a static TS file, no figma.* mocks required.
 */

import { describe, it, expect } from 'vitest';
import { PROPERTY_REGISTRY, type PropertyDef } from '../constants/figma-property-registry';

const ALL_NODE_TYPES = Object.keys(PROPERTY_REGISTRY);
const BINDABLE_TYPES = new Set(['FLOAT', 'BOOLEAN', 'STRING', 'COLOR']);

// Flatten once — most tests iterate every entry.
type Tagged = { nodeType: string; entry: PropertyDef };
const ALL_ENTRIES: Tagged[] = ALL_NODE_TYPES.flatMap((nodeType) =>
  PROPERTY_REGISTRY[nodeType].map((entry) => ({ nodeType, entry })),
);

function entriesForKey(key: string): Tagged[] {
  return ALL_ENTRIES.filter((t) => t.entry.key === key);
}

describe('PROPERTY_REGISTRY schema invariants', () => {
  it('exposes at least one node type', () => {
    expect(ALL_NODE_TYPES.length).toBeGreaterThan(0);
  });

  describe('required `writable` field', () => {
    it('every entry has writable: boolean', () => {
      for (const { nodeType, entry } of ALL_ENTRIES) {
        expect(
          typeof entry.writable,
          `${nodeType}.${entry.key} missing writable or wrong type`,
        ).toBe('boolean');
      }
    });
  });

  describe('optional `bindable` field', () => {
    it('when set, is one of FLOAT | BOOLEAN | STRING | COLOR', () => {
      for (const { nodeType, entry } of ALL_ENTRIES) {
        if (entry.bindable !== undefined) {
          expect(
            BINDABLE_TYPES.has(entry.bindable),
            `${nodeType}.${entry.key} has invalid bindable=${entry.bindable}`,
          ).toBe(true);
        }
      }
    });
  });

  describe('optional `facet` field', () => {
    it('when set, is a non-empty string', () => {
      for (const { nodeType, entry } of ALL_ENTRIES) {
        if (entry.facet !== undefined) {
          expect(typeof entry.facet).toBe('string');
          expect(
            entry.facet.length,
            `${nodeType}.${entry.key} has empty facet`,
          ).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('width/height (Q1 decision — computed post-layout)', () => {
    it('width entries are non-writable', () => {
      const widths = entriesForKey('width');
      expect(widths.length).toBeGreaterThan(0);
      for (const { nodeType, entry } of widths) {
        expect(entry.writable, `${nodeType}.width should be writable:false`).toBe(false);
      }
    });

    it('width entries have no bindable (binding creates visual no-op)', () => {
      for (const { nodeType, entry } of entriesForKey('width')) {
        expect(entry.bindable, `${nodeType}.width should have bindable:undefined`).toBeUndefined();
      }
    });

    it('height entries are non-writable', () => {
      const heights = entriesForKey('height');
      expect(heights.length).toBeGreaterThan(0);
      for (const { nodeType, entry } of heights) {
        expect(entry.writable, `${nodeType}.height should be writable:false`).toBe(false);
      }
    });

    it('height entries have no bindable (binding creates visual no-op)', () => {
      for (const { nodeType, entry } of entriesForKey('height')) {
        expect(entry.bindable, `${nodeType}.height should have bindable:undefined`).toBeUndefined();
      }
    });
  });

  describe('variable-state computed properties', () => {
    it('boundVariables: facet=variables AND writable=false on every node type that declares it', () => {
      const bvs = entriesForKey('boundVariables');
      expect(bvs.length).toBeGreaterThan(0);
      for (const { nodeType, entry } of bvs) {
        expect(entry.facet, `${nodeType}.boundVariables facet`).toBe('variables');
        expect(entry.writable, `${nodeType}.boundVariables writable`).toBe(false);
      }
    });

    it('explicitVariableModes: facet=variables on every node type that declares it', () => {
      const evms = entriesForKey('explicitVariableModes');
      expect(evms.length).toBeGreaterThan(0);
      for (const { nodeType, entry } of evms) {
        expect(entry.facet, `${nodeType}.explicitVariableModes facet`).toBe('variables');
      }
    });
  });

  describe('bindable audit whitelist', () => {
    it('TEXT.characters is bindable=STRING', () => {
      const textEntries = PROPERTY_REGISTRY.TEXT;
      expect(textEntries).toBeDefined();
      const characters = textEntries.find((e) => e.key === 'characters');
      expect(characters).toBeDefined();
      expect(characters!.bindable).toBe('STRING');
    });

    it('padding (top/right/bottom/left) is bindable=FLOAT everywhere it appears', () => {
      for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
        const entries = entriesForKey(key);
        expect(entries.length, `${key} must exist on at least one node type`).toBeGreaterThan(0);
        for (const { nodeType, entry } of entries) {
          expect(entry.bindable, `${nodeType}.${key} bindable`).toBe('FLOAT');
        }
      }
    });

    it('opacity is bindable=FLOAT everywhere it appears', () => {
      const entries = entriesForKey('opacity');
      expect(entries.length).toBeGreaterThan(0);
      for (const { nodeType, entry } of entries) {
        expect(entry.bindable, `${nodeType}.opacity bindable`).toBe('FLOAT');
      }
    });

    it('visible is bindable=BOOLEAN everywhere it appears', () => {
      const entries = entriesForKey('visible');
      expect(entries.length).toBeGreaterThan(0);
      for (const { nodeType, entry } of entries) {
        expect(entry.bindable, `${nodeType}.visible bindable`).toBe('BOOLEAN');
      }
    });

    it('fills/strokes are NOT bindable at node level (COLOR bindings live on Paint.boundVariables.color)', () => {
      for (const key of ['fills', 'strokes']) {
        for (const { nodeType, entry } of entriesForKey(key)) {
          expect(
            entry.bindable,
            `${nodeType}.${key} must not declare node-level bindable`,
          ).toBeUndefined();
        }
      }
    });
  });
});
