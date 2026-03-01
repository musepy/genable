/**
 * @file loopDetector.ts
 * @description Extracted loop detection logic from AgentRuntime.
 *
 * Detects three types of agent loops:
 * 1. Identical — exact same tool call signature repeated N times
 * 2. Planning — signal(type=plan) called 3+ times without progress
 * 3. Monotone — same tool-name pattern repeated (different args, same intent)
 */

import { LLMToolCall } from '../llm-client/providers/types';

export interface LoopDetectionResult {
  type: 'identical' | 'planning' | 'monotone';
  message: string;
  /** true = throw error to terminate; false = inject hint and continue */
  fatal: boolean;
  hint?: string;
}

export interface LoopThresholds {
  identical: number;
  monotone: number;
}

export class LoopDetector {
  private signatureHistory: string[] = [];
  private planningHistory: boolean[] = [];
  private readonly maxHistoryLength = 10;

  /**
   * Record this iteration's tool calls and run all loop detection checks.
   * Returns null if no loop detected.
   */
  detect(toolCalls: LLMToolCall[], thresholds: LoopThresholds): LoopDetectionResult | null {
    const semanticSignature = this.buildSignature(toolCalls);
    const hasPlanningSignal = toolCalls.some(
      tc => tc.name === 'signal' && tc.args?.type === 'plan'
    );

    this.signatureHistory.push(semanticSignature);
    if (this.signatureHistory.length > this.maxHistoryLength) {
      this.signatureHistory.shift();
    }
    this.planningHistory.push(hasPlanningSignal);
    if (this.planningHistory.length > this.maxHistoryLength) {
      this.planningHistory.shift();
    }

    // Check 1: Planning loop
    const planResult = this.detectPlanningLoop(toolCalls);
    if (planResult) return planResult;

    // Check 2: Identical signature loop
    const identicalResult = this.detectIdenticalLoop(semanticSignature, thresholds.identical);
    if (identicalResult) return identicalResult;

    // Check 3: Monotone tool-name pattern loop
    const monotoneResult = this.detectMonotoneLoop(thresholds.monotone);
    if (monotoneResult) return monotoneResult;

    return null;
  }

  /** Reset state (call at start of each run) */
  reset(): void {
    this.signatureHistory = [];
    this.planningHistory = [];
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Stable short hash for fingerprinting.
   */
  private hashString(value: string): string {
    if (!value) return '0';
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Truncate a value for signature inclusion.
   */
  private truncate(value: any, maxLength = 64): string {
    const text = String(value ?? '');
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '…';
  }

  /**
   * Build a semantic signature string from tool calls.
   * Each tool gets a fingerprint based on its name + target + relevant args.
   */
  private buildSignature(toolCalls: LLMToolCall[]): string {
    return toolCalls.map(tc => {
      const targetNodeId = tc.args?.nodeId;
      const parentId = tc.args?.parentId || tc.args?.parentRef;

      let fingerprint = '';
      const nameSample = tc.args?.name ? `|name:${this.truncate(tc.args.name, 64)}` : '';
      const contextSample = parentId ? `|parent:${this.truncate(parentId, 32)}` : '';

      if (tc.name === 'build_design' && typeof tc.args?.instructions === 'string') {
        const instrHash = this.hashString(tc.args.instructions.slice(0, 256));
        fingerprint = `|build:${instrHash}`;
      } else if (tc.name === 'patch_node' && Array.isArray(tc.args?.patches)) {
        const patchHash = this.hashString(JSON.stringify(
          tc.args.patches.map((p: any) => ({ n: p.nodeId, props: p.props }))
        ));
        fingerprint = `|patch:${tc.args.patches.length}|hash:${patchHash}`;
      } else if (tc.name === 'read_node') {
        const mode = tc.args?.mode || 'selection';
        const depth = tc.args?.depth ?? 5;
        fingerprint = `|mode:${mode}|depth:${depth}`;
      } else if (tc.name === 'validate_design' && tc.args?.nodeId) {
        fingerprint = `|validate:${this.truncate(tc.args.nodeId, 32)}`;
      } else if (tc.name === 'signal' && tc.args?.type) {
        const signalType = String(tc.args.type);
        const signalSummary = tc.args?.summary || tc.args?.title || tc.args?.analysis || '';
        fingerprint = `|signal:${signalType}|hash:${this.hashString(this.truncate(signalSummary, 128))}`;
      } else {
        fingerprint = `${nameSample}${contextSample}|args:${this.hashString(JSON.stringify(tc.args ?? {}))}`;
      }

      const patchNodeId = Array.isArray(tc.args?.patches) ? tc.args.patches[0]?.nodeId : undefined;
      const identifier = targetNodeId || patchNodeId || 'new';
      return `${tc.name}[${identifier}${fingerprint}]`;
    }).join('|');
  }

  /**
   * Detect planning signal called 3+ times consecutively.
   */
  private detectPlanningLoop(toolCalls: LLMToolCall[]): LoopDetectionResult | null {
    const hasPlanningCall = toolCalls.some(
      tc => tc.name === 'signal' && tc.args?.type === 'plan'
    );
    if (!hasPlanningCall) return null;

    let consecutivePlanning = 0;
    for (let i = this.planningHistory.length - 1; i >= 0; i--) {
      if (!this.planningHistory[i]) break;
      consecutivePlanning++;
    }

    if (consecutivePlanning >= 3) {
      return {
        type: 'planning',
        message: `Agent stuck in planning loop: planning signal emitted 3+ times consecutively. Try executing the first step instead of replanning.`,
        fatal: true,
      };
    }

    return null;
  }

  /**
   * Detect exact same signature repeated >= threshold times.
   */
  private detectIdenticalLoop(currentSignature: string, threshold: number): LoopDetectionResult | null {
    const count = this.signatureHistory.filter(sig => sig === currentSignature).length;
    if (count >= threshold) {
      return {
        type: 'identical',
        message: `[LOOP DETECTED] Same action repeated ${count} times: ${currentSignature}. ` +
          `Consider: (1) Check if previous tool succeeded (2) Try different approach (3) Call signal(type="complete") if done.`,
        fatal: true,
      };
    }
    return null;
  }

  /**
   * Detect same tool-name pattern repeated for N consecutive iterations.
   * Non-fatal: injects a completion hint instead of throwing.
   */
  private detectMonotoneLoop(threshold: number): LoopDetectionResult | null {
    if (this.signatureHistory.length < threshold) return null;

    const recentSignatures = this.signatureHistory.slice(-threshold);
    const toolNamePatterns = recentSignatures.map(sig => {
      return sig.split('|')
        .map(s => s.split('[')[0])
        .filter(Boolean)
        .sort()
        .join('+');
    });

    const allSamePattern = toolNamePatterns.every(p => p === toolNamePatterns[0]);
    if (!allSamePattern || !toolNamePatterns[0]) return null;

    // Only trigger for modify-only patterns (not read tools)
    const isModifyOnly = !toolNamePatterns[0].includes('read_node') &&
                         !toolNamePatterns[0].includes('validate_design') &&
                         !toolNamePatterns[0].includes('signal');
    if (!isModifyOnly) return null;

    const pattern = toolNamePatterns[0];
    return {
      type: 'monotone',
      message: `Monotone loop: tool pattern "${pattern}" repeated ${threshold} consecutive iterations.`,
      fatal: false,
      hint: `⚠️ LOOP DETECTED: You have called "${pattern}" for ${threshold} consecutive iterations. The design is good enough. Call signal(type="complete") NOW with a summary. Do NOT make any more style changes.`,
    };
  }
}
