/**
 * @file idempotency.test.ts
 * @description Tests for the canonical idempotency-key helpers.
 *
 * These are pure functions (no figma.* dependency). The tests cover:
 *   - canonical_json key-order invariance and primitive handling
 *   - sha256 hex digest stability across well-known inputs
 *   - computeVariableIdempotencyKey produces the spec §3.1 formula
 *   - key changes when values_by_mode changes (so dedup doesn't silently
 *     skip value updates)
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  sha256Hex,
  computeVariableIdempotencyKey,
} from '../idempotency';

describe('canonicalJson', () => {
  it('produces the same string regardless of key insertion order', () => {
    const a = canonicalJson({ a: 1, b: 2, c: 3 });
    const b = canonicalJson({ c: 3, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('sorts nested object keys recursively', () => {
    const a = canonicalJson({ outer: { z: 1, a: 2 } });
    const b = canonicalJson({ outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
    expect(a).toContain('"a":2');
    // 'a' should come before 'z' in the canonical form
    expect(a.indexOf('"a"')).toBeLessThan(a.indexOf('"z"'));
  });

  it('preserves array element order (arrays are semantic)', () => {
    expect(canonicalJson([1, 2, 3])).toBe('[1,2,3]');
    expect(canonicalJson([3, 2, 1])).toBe('[3,2,1]');
  });

  it('handles primitives as JSON.stringify would', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('hi')).toBe('"hi"');
    expect(canonicalJson(true)).toBe('true');
  });
});

describe('sha256Hex', () => {
  it('produces the well-known digest for the empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('produces the well-known digest for "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('handles UTF-8 multi-byte input', () => {
    // Reference value computed externally for "你好"
    expect(sha256Hex('你好')).toBe(
      '670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e',
    );
  });

  it('returns a 64-char lowercase hex string', () => {
    const out = sha256Hex('arbitrary input');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeVariableIdempotencyKey', () => {
  it('produces a stable hash for the same (collection_id, name, type, values_by_mode)', () => {
    const k1 = computeVariableIdempotencyKey({
      collection_id: 'C1',
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: { Light: '#111', Dark: '#EEE' },
    });
    const k2 = computeVariableIdempotencyKey({
      collection_id: 'C1',
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: { Light: '#111', Dark: '#EEE' },
    });
    expect(k1).toBe(k2);
  });

  it('is invariant to values_by_mode key insertion order', () => {
    const k1 = computeVariableIdempotencyKey({
      collection_id: 'C1',
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: { Light: '#111', Dark: '#EEE' },
    });
    const k2 = computeVariableIdempotencyKey({
      collection_id: 'C1',
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: { Dark: '#EEE', Light: '#111' },
    });
    expect(k1).toBe(k2);
  });

  it('changes when values_by_mode changes (caller must explicitly set_variable_value to update)', () => {
    const k1 = computeVariableIdempotencyKey({
      collection_id: 'C1',
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: { Light: '#111' },
    });
    const k2 = computeVariableIdempotencyKey({
      collection_id: 'C1',
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: { Light: '#222' },
    });
    expect(k1).not.toBe(k2);
  });

  it('changes when name, type, or collection_id changes', () => {
    const base = {
      collection_id: 'C1',
      name: 'Text/Primary',
      type: 'COLOR' as const,
      values_by_mode: { Light: '#111' },
    };
    const baseKey = computeVariableIdempotencyKey(base);
    expect(computeVariableIdempotencyKey({ ...base, name: 'Text/Secondary' })).not.toBe(baseKey);
    expect(computeVariableIdempotencyKey({ ...base, type: 'FLOAT' })).not.toBe(baseKey);
    expect(computeVariableIdempotencyKey({ ...base, collection_id: 'C2' })).not.toBe(baseKey);
  });

  it('treats omitted/empty values_by_mode as `{}`', () => {
    const k1 = computeVariableIdempotencyKey({
      collection_id: 'C1',
      name: 'X',
      type: 'COLOR',
      values_by_mode: {},
    });
    const k2 = computeVariableIdempotencyKey({
      collection_id: 'C1',
      name: 'X',
      type: 'COLOR',
      // @ts-expect-error — exercise the optional-coalesce path
      values_by_mode: undefined,
    });
    expect(k1).toBe(k2);
  });
});
