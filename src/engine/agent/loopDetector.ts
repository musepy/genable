/**
 * @file loopDetector.ts
 * @description Extracted loop detection logic from AgentRuntime.
 *
 * Detects two types of agent loops:
 * 1. Identical — exact same tool call signature repeated N times
 * 2. Monotone — same tool-name pattern repeated (different args, same intent)
 */

import { LLMToolCall } from '../llm-client/providers/types';

export interface LoopDetectionResult {
  type: 'identical' | 'monotone';
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
  private identicalGraceGiven = false;
  private readonly maxHistoryLength = 10;
  private readonly readTools = new Set(['context', 'outline', 'inspect']);

  /**
   * Record this iteration's tool calls and run all loop detection checks.
   * Returns null if no loop detected.
   */
  detect(toolCalls: LLMToolCall[], thresholds: LoopThresholds): LoopDetectionResult | null {
    const semanticSignature = this.buildSignature(toolCalls);

    this.signatureHistory.push(semanticSignature);
    if (this.signatureHistory.length > this.maxHistoryLength) {
      this.signatureHistory.shift();
    }

    // Check 1: Identical signature loop
    const identicalResult = this.detectIdenticalLoop(semanticSignature, thresholds.identical);
    if (identicalResult) return identicalResult;

    // Check 2: Monotone tool-name pattern loop
    const monotoneResult = this.detectMonotoneLoop(thresholds.monotone);
    if (monotoneResult) return monotoneResult;

    return null;
  }

  /** Reset state (call at start of each run) */
  reset(): void {
    this.signatureHistory = [];
    this.identicalGraceGiven = false;
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

      if (tc.name === 'create' && tc.args?.xml) {
        const instrHash = this.hashString(String(tc.args.xml).slice(0, 256));
        fingerprint = `|build:${instrHash}`;
      } else if (tc.name === 'edit' && tc.args?.xml) {
        const editHash = this.hashString(String(tc.args.xml).slice(0, 256));
        fingerprint = `|edit:${editHash}`;
      } else if (tc.name === 'outline' || tc.name === 'inspect') {
        const depth = tc.args?.depth ?? 5;
        fingerprint = `|depth:${depth}`;
      } else if (tc.name === 'context') {
        fingerprint = `|static`;
      } else {
        fingerprint = `${nameSample}${contextSample}|args:${this.hashString(JSON.stringify(tc.args ?? {}))}`;
      }

      const identifier = targetNodeId || 'new';
      return `${tc.name}[${identifier}${fingerprint}]`;
    }).join('|');
  }

  /**
   * Detect exact same signature repeated >= threshold times.
   * First occurrence gives the agent a grace chance to explain; second is fatal.
   */
  private detectIdenticalLoop(currentSignature: string, threshold: number): LoopDetectionResult | null {
    const count = this.signatureHistory.filter(sig => sig === currentSignature).length;
    if (count < threshold) return null;

    if (!this.identicalGraceGiven) {
      this.identicalGraceGiven = true;
      return {
        type: 'identical',
        message: `[LOOP DETECTED] Same action repeated ${count} times.`,
        fatal: false,
        hint: `You repeated the same action ${count} times. Stop retrying. `
          + `Explain to the user what you were trying to do and why it's not working.`,
      };
    }

    return {
      type: 'identical',
      message: `[LOOP DETECTED] Same action repeated ${count} times after grace warning: ${currentSignature}. Terminating.`,
      fatal: true,
    };
  }

  /**
   * Detect same tool-name pattern repeated for N consecutive iterations.
   * Non-fatal: injects a completion hint instead of throwing.
   */
  private detectMonotoneLoop(threshold: number): LoopDetectionResult | null {
    if (this.signatureHistory.length < threshold) return null;

    const recentSignatures = this.signatureHistory.slice(-threshold);
    const toolNamePatterns = recentSignatures.map(sig => this.extractToolPattern(sig));

    const allSamePattern = toolNamePatterns.every(p => p === toolNamePatterns[0]);
    if (!allSamePattern || !toolNamePatterns[0]) return null;

    const pattern = toolNamePatterns[0];
    const patternTools = pattern.split('+').filter(Boolean);
    const isReadOnly = patternTools.every(tool => this.readTools.has(tool));
    const includesReadTool = patternTools.some(tool => this.readTools.has(tool));

    return {
      type: 'monotone',
      message: `Monotone loop: tool pattern "${pattern}" repeated ${threshold} consecutive iterations.`,
      fatal: false,
      hint: isReadOnly
        ? `You have only used read-only tools ("${pattern}") for ${threshold} consecutive iterations. `
          + `Stop inspecting more nodes unless a new inspection will change your plan. Either make the next edit/create call or explain the blocking issue to the user.`
        : includesReadTool
          ? `You have repeated the same inspection/modify pattern ("${pattern}") for ${threshold} consecutive iterations. `
            + `Do not keep verifying the same area. Make a concrete change, or explain the blocker to the user.`
          : `You have called "${pattern}" for ${threshold} consecutive iterations without resolving the issue. `
            + `If you are stuck, explain the difficulty to the user.`,
    };
  }

  private extractToolPattern(signature: string): string {
    const toolNames = [...signature.matchAll(/([a-zA-Z_]+)\[/g)]
      .map(match => match[1])
      .filter(Boolean)
      .sort();
    return toolNames.join('+');
  }
}
