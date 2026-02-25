/**
 * @file loopDetector.ts
 * @description Extracted loop detection logic from AgentRuntime.
 *
 * Detects three types of agent loops:
 * 1. Identical — exact same tool call signature repeated N times
 * 2. Planning — planDesign called 3+ times without progress
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
  private readonly maxHistoryLength = 10;

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

      if (tc.name === 'updateNodeProperties' && tc.args?.properties) {
        const propsHash = this.hashString(JSON.stringify(tc.args.properties));
        fingerprint = `|props:${propsHash}`;
      } else if (tc.name === 'setNodeStyles' && (tc.args?.fills || tc.args?.strokes)) {
        const stylesHash = this.hashString(JSON.stringify({ f: tc.args.fills, s: tc.args.strokes }));
        fingerprint = `|style:${stylesHash}`;
      } else if (tc.name === 'createNode') {
        fingerprint = `${nameSample}${contextSample}`;
      } else if (tc.name === 'createIcon' && tc.args?.iconName) {
        fingerprint = `|icon:${tc.args.iconName}${contextSample}`;
      } else if (tc.name === 'applyDesignPatch' && tc.args?.patches?.length > 0) {
        const patchHash = this.hashString(JSON.stringify(
          tc.args.patches.map((p: any) => ({ n: p.nodeId || p.nodeRef, l: !!p.layout, s: !!p.styles }))
        ));
        fingerprint = `|patch:${tc.args.patches.length}|hash:${patchHash}`;
      } else if (tc.name === 'batchOperations' && Array.isArray(tc.args?.operations)) {
        const opIds = tc.args.operations
          .map((op: any) => op?.opId || op?.action)
          .filter(Boolean)
          .join(',');
        fingerprint = `|batch:${tc.args.operations.length}|ops:${this.hashString(opIds)}`;
      } else if (tc.name === 'summarize_progress' && tc.args?.summary) {
        fingerprint = `|sum:${this.hashString(tc.args.summary)}`;
      } else if (tc.name === 'update_todo_list' && tc.args?.items) {
        fingerprint = `|todo:${this.hashString(JSON.stringify(tc.args.items))}`;
      } else if (tc.name === 'new_task' && (tc.args?.title || tc.args?.description)) {
        fingerprint = `|task:${this.hashString(tc.args.title + '|' + tc.args.description)}`;
      } else if (tc.name === 'planDesign' && tc.args?.analysis) {
        fingerprint = `|plan:${this.hashString(tc.args.analysis)}`;
      } else if (tc.name === 'inspectDesign') {
        const mode = tc.args?.mode || 'selection';
        const depth = tc.args?.depth ?? 5;
        fingerprint = `|mode:${mode}|depth:${depth}`;
      }

      const identifier = targetNodeId || 'new';
      return `${tc.name}[${identifier}${fingerprint}]`;
    }).join('|');
  }

  /**
   * Detect planDesign called 3+ times consecutively.
   */
  private detectPlanningLoop(toolCalls: LLMToolCall[]): LoopDetectionResult | null {
    const planCallCount = toolCalls.filter(tc => tc.name === 'planDesign').length;
    if (planCallCount > 0) {
      const recentPlanCalls = this.signatureHistory.filter(sig => sig.includes('planDesign'));
      if (recentPlanCalls.length >= 3) {
        return {
          type: 'planning',
          message: `Agent stuck in planning loop: planDesign called 3+ times consecutively. Try giving more specific instructions.`,
          fatal: true,
        };
      }
    }
    return null;
  }

  /**
   * Detect exact same signature repeated >= threshold times.
   */
  private detectIdenticalLoop(currentSignature: string, threshold: number): LoopDetectionResult | null {
    if (currentSignature.includes('complete_step')) return null;

    const count = this.signatureHistory.filter(sig => sig === currentSignature).length;
    if (count >= threshold) {
      return {
        type: 'identical',
        message: `[LOOP DETECTED] Same action repeated ${count} times: ${currentSignature}. ` +
          `Consider: (1) Check if previous tool succeeded (2) Try different approach (3) Call complete_task if done.`,
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
    const isModifyOnly = !toolNamePatterns[0].includes('inspectDesign') &&
                         !toolNamePatterns[0].includes('planDesign') &&
                         !toolNamePatterns[0].includes('complete_task') &&
                         !toolNamePatterns[0].includes('complete_step');
    if (!isModifyOnly) return null;

    const pattern = toolNamePatterns[0];
    return {
      type: 'monotone',
      message: `Monotone loop: tool pattern "${pattern}" repeated ${threshold} consecutive iterations.`,
      fatal: false,
      hint: `⚠️ LOOP DETECTED: You have called "${pattern}" for ${threshold} consecutive iterations. The design is good enough. Call complete_task NOW with a summary. Do NOT make any more style changes.`,
    };
  }
}
