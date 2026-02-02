/**
 * @file performance.ts
 * @description Centralized logic for LLM performance configurations and constraints.
 * 
 * This module ensures "Single Source of Truth" and "Unified Dependence":
 * - Token limits directly influence timeout calculations.
 * - Thinking levels add deterministic overhead to time budgets.
 * - Performance profiles provide a slider-ready abstraction.
 */

import { ThinkingLevel } from './config';

/**
 * Performance Profile Definition
 */
export interface LLMPerformanceProfile {
  id: string;
  name: string;
  maxOutputTokens: number;
  thinkingLevel: ThinkingLevel;
  /** Buffer time for network and parsing (ms) */
  safetyBufferMs: number;
}

/**
 * Unified Dependence:
 * Calculate a safe request timeout based on the token budget and thinking overhead.
 * 
 * Formula: (Tokens / Avg_TPS) + Thinking_Cost + Safety_Buffer
 */
export function calculateTimeoutMs(profile: LLMPerformanceProfile): number {
  // [Gemini Protocol] We no longer enforce client-side timeouts.
  // The model should be allowed to think and generate as long as necessary.
  return Infinity;
}

/**
 * Available Performance Presets
 * Can be mapped to a UI slider: [Speed, Balanced, Complex]
 */
export const PERFORMANCE_PROFILES: Record<string, LLMPerformanceProfile> = {
  /** High speed, minimal thinking, low token budget (Safe for 90s) */
  'speed': {
    id: 'speed',
    name: 'Speed (Drafts)',
    maxOutputTokens: 8192,
    thinkingLevel: 'minimal',
    safetyBufferMs: 15000
  },
  /** Balanced approach (The safe default) */
  'balanced': {
    id: 'balanced',
    name: 'Balanced (Standard)',
    // FIX: Increased from 32768 to 65536 to prevent MALFORMED_FUNCTION_CALL
    // when generating complex layouts with many nodes
    maxOutputTokens: 65536,
    thinkingLevel: 'low',
    safetyBufferMs: 25000
  },
  /** High complexity, deep thinking, long timeout (May exceed 90s) */
  'complex': {
    id: 'complex',
    name: 'Quality (Complex Layouts)',
    maxOutputTokens: 65536,
    thinkingLevel: 'high',
    safetyBufferMs: 40000
  }
};

/**
 * The "Single Source of Truth" for the current session.
 * In the future, this can be synced from figma.clientStorage.
 */
export const CURRENT_PERFORMANCE_ID = 'balanced';

export function getActivePerformance(): LLMPerformanceProfile & { timeoutMs: number } {
  const profile = PERFORMANCE_PROFILES[CURRENT_PERFORMANCE_ID];
  return {
    ...profile,
    timeoutMs: calculateTimeoutMs(profile)
  };
}
