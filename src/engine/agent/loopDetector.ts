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
  private readonly maxHistoryLength = 10;
  private readonly readTools = new Set(['context', 'outline', 'inspect', 'ls', 'tree', 'cat', 'grep', 'man']);

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

      if (tc.name === 'edit' && tc.args?.xml) {
        const editHash = this.hashString(String(tc.args.xml).slice(0, 256));
        fingerprint = `|edit:${editHash}`;
      } else if (tc.name === 'outline' || tc.name === 'inspect') {
        const depth = tc.args?.depth ?? 5;
        fingerprint = `|depth:${depth}`;
      } else if (tc.name === 'context') {
        fingerprint = `|static`;
      } else if (tc.name === 'ls' || tc.name === 'tree' || tc.name === 'cat' || tc.name === 'grep' || tc.name === 'man') {
        // VFS/read commands: fingerprint by path
        const path = tc.args?.path || tc.args?.query || '/';
        const depth = tc.args?.depth ?? 5;
        fingerprint = `|path:${this.truncate(path, 64)}|depth:${depth}`;
      } else if (tc.name === 'mk') {
        // mk: fingerprint by path + batch hash
        const path = tc.args?.path || '';
        const batch = tc.args?.batch;
        fingerprint = batch
          ? `|batch:${this.hashString(String(batch).slice(0, 256))}`
          : `|path:${this.truncate(path, 64)}`;
      } else if (tc.name === 'sed') {
        const path = tc.args?.path || '';
        fingerprint = `|path:${this.truncate(path, 64)}|args:${this.hashString(JSON.stringify(tc.args?.replacements ?? {}))}`;
      } else {
        fingerprint = `${nameSample}${contextSample}|args:${this.hashString(JSON.stringify(tc.args ?? {}))}`;
      }

      const identifier = targetNodeId || 'new';
      return `${tc.name}[${identifier}${fingerprint}]`;
    }).join('|');
  }

  /**
   * Detect exact same signature repeated >= threshold times.
   * Always non-fatal — injects a hint but never terminates.
   * Other guardrails (consecutive failure escalation, iteration budget)
   * handle actual stuck scenarios more precisely.
   */
  private detectIdenticalLoop(currentSignature: string, threshold: number): LoopDetectionResult | null {
    const count = this.signatureHistory.filter(sig => sig === currentSignature).length;
    if (count < threshold) return null;

    return {
      type: 'identical',
      message: `[LOOP WARNING] Same action repeated ${count} times.`,
      fatal: false,
      hint: `You repeated the same action ${count} times. If you are making progress (creating new nodes, fixing errors), continue. `
        + `If stuck, change approach or explain the blocker to the user.`,
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
