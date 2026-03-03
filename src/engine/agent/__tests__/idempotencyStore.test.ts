import { describe, it, expect, beforeEach } from 'vitest';
import {
  IdempotencyStore,
  computeRequestHash,
  canonicalizeBuildDesignParams,
} from '../idempotencyStore';

describe('computeRequestHash', () => {
  it('returns consistent hash for same input', () => {
    const a = computeRequestHash('hello');
    const b = computeRequestHash('hello');
    expect(a).toBe(b);
  });

  it('returns different hashes for different input', () => {
    const a = computeRequestHash('hello');
    const b = computeRequestHash('world');
    expect(a).not.toBe(b);
  });
});

describe('canonicalizeBuildDesignParams', () => {
  it('normalizes defaults', () => {
    const ops = [{ op: 'create', type: 'FRAME', props: {} }];
    const a = canonicalizeBuildDesignParams({ operations: ops });
    const b = canonicalizeBuildDesignParams({
      operations: ops,
      onError: 'continue',
      rollbackMode: 'none',
    });
    expect(a).toBe(b);
  });

  it('produces different hashes for different operations', () => {
    const a = canonicalizeBuildDesignParams({
      operations: [{ op: 'create', type: 'FRAME', props: {} }],
    });
    const b = canonicalizeBuildDesignParams({
      operations: [{ op: 'create', type: 'TEXT', props: {} }],
    });
    expect(a).not.toBe(b);
  });

  it('differentiates by parentId', () => {
    const ops = [{ op: 'update', target: 'card', props: { width: 100 } }];
    const a = canonicalizeBuildDesignParams({ operations: ops, parentId: '1:2' });
    const b = canonicalizeBuildDesignParams({ operations: ops, parentId: '3:4' });
    expect(a).not.toBe(b);
  });
});

describe('IdempotencyStore', () => {
  let store: IdempotencyStore;

  beforeEach(() => {
    store = new IdempotencyStore(10, 60_000);
    store.setRunId('run_abc');
  });

  it('returns miss on empty store', () => {
    const result = store.check('run_abc:call_1', 'hash_a');
    expect(result.hit).toBe(false);
    expect('conflict' in result && result.conflict).toBeFalsy();
  });

  it('returns hit on matching key + hash', () => {
    const key = store.makeKey('call_1');
    const cached = { success: true, data: { idMap: { card: '1:2' } } };
    store.set(key, 'hash_a', cached);

    const result = store.check(key, 'hash_a');
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.result).toBe(cached);
    }
  });

  it('returns conflict on matching key + different hash', () => {
    const key = store.makeKey('call_1');
    store.set(key, 'hash_a', { success: true });

    const result = store.check(key, 'hash_b');
    expect(result.hit).toBe(false);
    if (!result.hit && result.conflict) {
      expect(result.oldHash).toBe('hash_a');
      expect(result.newHash).toBe('hash_b');
    } else {
      expect.fail('Expected conflict');
    }
  });

  it('clears entries on run change', () => {
    const key = store.makeKey('call_1');
    store.set(key, 'hash_a', { success: true });
    expect(store.size).toBe(1);

    store.setRunId('run_def');
    expect(store.size).toBe(0);
  });

  it('does not clear on same run ID', () => {
    const key = store.makeKey('call_1');
    store.set(key, 'hash_a', { success: true });

    store.setRunId('run_abc');
    expect(store.size).toBe(1);
  });

  it('evicts oldest entry when at max capacity', () => {
    const maxEntries = 3;
    store = new IdempotencyStore(maxEntries, 60_000);
    store.setRunId('run_abc');

    for (let i = 0; i < maxEntries; i++) {
      store.set(`key_${i}`, `hash_${i}`, { i });
    }
    expect(store.size).toBe(maxEntries);

    // Adding one more should evict the oldest (key_0)
    store.set('key_new', 'hash_new', { new: true });
    expect(store.size).toBe(maxEntries);

    const evicted = store.check('key_0', 'hash_0');
    expect(evicted.hit).toBe(false);

    const kept = store.check('key_1', 'hash_1');
    expect(kept.hit).toBe(true);
  });

  it('expires entries after TTL', () => {
    const shortTtl = 50; // 50ms
    store = new IdempotencyStore(10, shortTtl);
    store.setRunId('run_abc');

    const key = 'key_ttl';
    store.set(key, 'hash_a', { success: true });

    // Immediately should hit
    expect(store.check(key, 'hash_a').hit).toBe(true);

    // After TTL, should miss
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = store.check(key, 'hash_a');
        expect(result.hit).toBe(false);
        resolve();
      }, shortTtl + 10);
    });
  });

  it('makeKey combines runId and callId', () => {
    const key = store.makeKey('call_xyz');
    expect(key).toBe('run_abc:call_xyz');
  });
});
