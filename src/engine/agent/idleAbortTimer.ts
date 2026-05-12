/**
 * @file idleAbortTimer.ts
 * @description Idle-reset abort timer for LLM streams.
 *
 * Replaces the previous wall-clock 5-min total-budget abort with an
 * idle-since-last-activity abort. Each streaming chunk (text/reasoning/etc.)
 * calls `kick()` to reset the timer. If `intervalMs` elapses with no kick,
 * `onIdle` fires — typically `abortController.abort()`.
 *
 * Why idle, not wall-clock: thinking-heavy models (e.g. kimi-k2.6) can
 * legitimately stream `reasoning_content` for several minutes before the
 * final assistant message. The server is producing chunks the whole time;
 * a wall-clock timer kills live work and surfaces "BodyStreamBuffer was
 * aborted" to users. An idle timer aborts only genuinely-hung streams.
 */

export interface IdleAbortTimerOptions {
  /** Idle window (ms). When this much time passes between kicks, onIdle fires. */
  intervalMs: number;
  /** Called when the idle window elapses without a kick. */
  onIdle: () => void;
}

/**
 * Single-shot idle timer. After `start()`:
 *   - `kick()` resets the countdown.
 *   - When the interval elapses with no kick, `onIdle` fires once.
 *   - `cancel()` stops the timer; subsequent `kick()` calls are no-ops.
 *
 * Not reusable — create a new instance per LLM call.
 */
export class IdleAbortTimer {
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private fired = false;
  private canceled = false;

  constructor(private readonly options: IdleAbortTimerOptions) {}

  /** Begin the idle countdown. Idempotent — calling twice is a no-op. */
  start(): void {
    if (this.timeoutHandle !== null || this.fired || this.canceled) return;
    this.arm();
  }

  /**
   * Reset the idle countdown. Call on every stream chunk (text, reasoning,
   * tool-call delta) to mark "the stream is alive". No-op if not started,
   * already fired, or canceled.
   */
  kick(): void {
    if (this.fired || this.canceled) return;
    if (this.timeoutHandle === null) return;
    clearTimeout(this.timeoutHandle);
    this.arm();
  }

  /** Stop the timer. Safe to call multiple times; safe in `finally` blocks. */
  cancel(): void {
    if (this.canceled) return;
    this.canceled = true;
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  /** True if `onIdle` has fired (idle window elapsed without a kick). */
  hasFired(): boolean {
    return this.fired;
  }

  private arm(): void {
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      if (this.canceled || this.fired) return;
      this.fired = true;
      this.options.onIdle();
    }, this.options.intervalMs);
  }
}
