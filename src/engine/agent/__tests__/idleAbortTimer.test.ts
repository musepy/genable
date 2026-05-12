/**
 * @file idleAbortTimer.test.ts
 * @description Unit tests for the idle-reset abort timer.
 * Pure-logic class with no Figma/LLM deps — safe to unit-test (per CLAUDE.md).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleAbortTimer } from '../idleAbortTimer';

describe('IdleAbortTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire when kicked under the interval', () => {
    const onIdle = vi.fn();
    const timer = new IdleAbortTimer({ intervalMs: 1000, onIdle });
    timer.start();

    // Advance 800ms, kick → reset
    vi.advanceTimersByTime(800);
    timer.kick();
    // Advance another 800ms (total 1600 since start, but only 800 since last kick)
    vi.advanceTimersByTime(800);
    expect(onIdle).not.toHaveBeenCalled();
    expect(timer.hasFired()).toBe(false);

    // Kick again, advance just under interval
    timer.kick();
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();

    timer.cancel();
  });

  it('fires after the interval elapses with no kick', () => {
    const onIdle = vi.fn();
    const timer = new IdleAbortTimer({ intervalMs: 1000, onIdle });
    timer.start();

    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.hasFired()).toBe(true);
  });

  it('fires after silence even when earlier kicks occurred', () => {
    const onIdle = vi.fn();
    const timer = new IdleAbortTimer({ intervalMs: 1000, onIdle });
    timer.start();

    vi.advanceTimersByTime(500);
    timer.kick();
    vi.advanceTimersByTime(500);
    timer.kick();
    expect(onIdle).not.toHaveBeenCalled();

    // Now go silent for full interval
    vi.advanceTimersByTime(1001);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('cancel() prevents the timer from firing', () => {
    const onIdle = vi.fn();
    const timer = new IdleAbortTimer({ intervalMs: 1000, onIdle });
    timer.start();

    vi.advanceTimersByTime(500);
    timer.cancel();
    vi.advanceTimersByTime(10000);
    expect(onIdle).not.toHaveBeenCalled();
    expect(timer.hasFired()).toBe(false);
  });

  it('cancel() is idempotent', () => {
    const onIdle = vi.fn();
    const timer = new IdleAbortTimer({ intervalMs: 1000, onIdle });
    timer.start();
    timer.cancel();
    timer.cancel();
    timer.cancel();
    vi.advanceTimersByTime(10000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('kick() after cancel() is a no-op (does not re-arm)', () => {
    const onIdle = vi.fn();
    const timer = new IdleAbortTimer({ intervalMs: 1000, onIdle });
    timer.start();
    timer.cancel();

    timer.kick();
    vi.advanceTimersByTime(10000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('kick() before start() is a no-op', () => {
    const onIdle = vi.fn();
    const timer = new IdleAbortTimer({ intervalMs: 1000, onIdle });
    // No start()
    timer.kick();
    vi.advanceTimersByTime(10000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('start() is idempotent — calling twice does not double-arm', () => {
    const onIdle = vi.fn();
    const timer = new IdleAbortTimer({ intervalMs: 1000, onIdle });
    timer.start();
    timer.start();

    vi.advanceTimersByTime(1001);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('onIdle fires at most once even if timer keeps running', () => {
    const onIdle = vi.fn();
    const timer = new IdleAbortTimer({ intervalMs: 1000, onIdle });
    timer.start();

    vi.advanceTimersByTime(1001);
    expect(onIdle).toHaveBeenCalledTimes(1);

    // After firing, further kicks do not re-arm.
    timer.kick();
    vi.advanceTimersByTime(10000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
