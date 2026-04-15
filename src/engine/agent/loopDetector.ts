/**
 * @file loopDetector.ts
 * @description Form-agnostic agent loop detection.
 *
 * Pure signature comparison — no knowledge of individual tool internals.
 * Callers build a {@link LoopFingerprint} via `buildLoopFingerprint()` and
 * feed it in. The detector answers a single question: "did this pattern
 * repeat?"
 *
 * Two failure modes detected:
 *   identical — exact same call repeated N times (e.g. `inspect(1:2)` × 4)
 *   monotone  — same set of tool names N consecutive iterations with
 *               different args (e.g. `inspect` on 4 different nodes without
 *               any mutation in between)
 *
 * Both results are non-fatal by design: the hook layer injects a hint and
 * lets the agent decide. Hard termination is the job of iteration budget
 * and consecutive-failure guardrails, not loop detection.
 */

/**
 * Per-iteration fingerprint. Built by {@link buildLoopFingerprint}; the
 * detector never inspects raw tool calls.
 */
export interface LoopFingerprint {
  /** Sorted, '+' joined tool names. Used for monotone detection. */
  toolsKey: string;
  /** Deterministic full signature (names + stable-stringified args). Used for identical detection. */
  signature: string;
}

export interface LoopDetectionResult {
  type: 'identical' | 'monotone';
  message: string;
  hint: string;
}

export interface LoopThresholds {
  identical: number;
  monotone: number;
}

export class LoopDetector {
  private history: LoopFingerprint[] = [];
  private readonly maxHistoryLength = 10;

  /**
   * Record the current iteration's fingerprint and run detection.
   * Returns null when no loop is detected.
   */
  detect(fp: LoopFingerprint, thresholds: LoopThresholds): LoopDetectionResult | null {
    this.history.push(fp);
    if (this.history.length > this.maxHistoryLength) {
      this.history.shift();
    }

    return (
      this.detectIdentical(fp.signature, thresholds.identical)
      ?? this.detectMonotone(fp.toolsKey, thresholds.monotone)
    );
  }

  /** Clear history. Call at the start of each run. */
  reset(): void {
    this.history = [];
  }

  // ── Private ────────────────────────────────────────────────────

  private detectIdentical(currentSignature: string, threshold: number): LoopDetectionResult | null {
    if (!currentSignature) return null;
    const count = this.history.filter(h => h.signature === currentSignature).length;
    if (count < threshold) return null;

    return {
      type: 'identical',
      message: `[LOOP WARNING] Same action repeated ${count} times.`,
      hint:
        `You repeated the same action ${count} times. `
        + `If you are making progress (new nodes created, errors fixed), continue. `
        + `If stuck, change approach or explain the blocker to the user.`,
    };
  }

  private detectMonotone(currentToolsKey: string, threshold: number): LoopDetectionResult | null {
    if (!currentToolsKey || this.history.length < threshold) return null;

    const recent = this.history.slice(-threshold);
    const allSame = recent.every(h => h.toolsKey === currentToolsKey);
    if (!allSame) return null;

    return {
      type: 'monotone',
      message: `Monotone loop: tool pattern "${currentToolsKey}" repeated ${threshold} consecutive iterations.`,
      hint:
        `You have called the same tools ("${currentToolsKey}") for ${threshold} consecutive iterations. `
        + `Make a concrete change or explain the blocker to the user.`,
    };
  }
}
