/**
 * @file retryLoop.ts
 * @description Self-Correction Loop with exponential backoff
 * 
 * [PLAYBOOK Phase 2.2] Generate layout with lint-based feedback:
 * 1. Generate initial layout
 * 2. Run lint() to detect semantic/physics violations
 * 3. If errors found, construct retry prompt with exponential backoff
 * 4. Repeat until no errors or maxRetries reached
 */

import { NodeLayer } from '../../schema/layerSchema';
import { lint, hasErrors, formatWarningsForRetry } from '../layout-engine';
import { LintWarning } from '../layout-engine/types';
import { GEMINI_CONFIG } from './config';
import { generateLayout } from './generator';
import {
  GenerateLayoutWithRetryOptions,
  GenerateLayoutWithRetryResult,
} from './types';

/**
 * Delay helper for exponential backoff
 */
const delay = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate exponential backoff delay
 * @param attempt - Current attempt number (1-indexed)
 * @returns Delay in milliseconds
 */
function calculateBackoff(attempt: number): number {
  return Math.pow(2, attempt - 1) * GEMINI_CONFIG.RETRY_BASE_DELAY_MS;
}

/**
 * Generate layout with Self-Correction Loop
 * 
 * This function wraps generateLayout with lint-based feedback:
 * 1. Generate initial layout
 * 2. Run lint() to detect semantic/physics violations
 * 3. If errors found, wait with exponential backoff and re-generate
 * 4. Repeat until no errors or maxRetries reached
 * 
 * @param options - Generation options including retry configuration
 * @returns Result with final data and retry metadata
 */
export async function generateLayoutWithRetry(
  options: GenerateLayoutWithRetryOptions
): Promise<GenerateLayoutWithRetryResult> {
  const { 
    enableRetry = true, 
    maxRetries = GEMINI_CONFIG.DEFAULT_MAX_RETRIES, 
    designSystemId = 'shadcn',
    onRetry,
    ...baseOptions 
  } = options;

  let currentOptions = baseOptions;
  let retryCount = 0;
  let lastResult: { data: NodeLayer; rawText: string };
  let lastWarnings: LintWarning[] = [];

  // First attempt
  options.onProgress?.('[1/1] Generating layout...');
  lastResult = await generateLayout(currentOptions);

  // If retry is disabled, return immediately
  if (!enableRetry) {
    return {
      ...lastResult,
      retryCount: 0,
      finalWarnings: [],
      hasRemainingErrors: false
    };
  }

  // Lint check
  options.onProgress?.('Validating design constraints...');
  lastWarnings = lint(lastResult.data);
  
  console.log(`[Self-Correction] Initial lint: ${lastWarnings.length} warning(s), ${lastWarnings.filter(w => w.severity === 'error').length} error(s)`);

  // Retry loop with exponential backoff
  while (hasErrors(lastWarnings) && retryCount < maxRetries) {
    retryCount++;
    
    // Calculate and apply exponential backoff
    const backoffMs = calculateBackoff(retryCount);
    console.log(`[Self-Correction] Waiting ${backoffMs}ms before retry ${retryCount}/${maxRetries}`);
    await delay(backoffMs);
    
    const retryPrompt = formatWarningsForRetry(lastWarnings);
    console.log(`[Self-Correction] Retry ${retryCount}/${maxRetries}:`, retryPrompt);
    
    // Notify callback
    onRetry?.(lastWarnings, retryCount);
    options.onProgress?.(`[Retry ${retryCount}/${maxRetries}] Fixing ${lastWarnings.filter(w => w.severity === 'error').length} error(s)...`);

    // Build retry options with correction context
    currentOptions = {
      ...baseOptions,
      userPrompt: `${baseOptions.userPrompt}\n\n[DESIGN CONSTRAINT VIOLATIONS - PLEASE FIX]\n${retryPrompt}`,
      // Add previous output context for better correction
      history: [
        ...(baseOptions.history || []),
        { role: 'model' as const, text: lastResult.rawText },
        { role: 'user' as const, text: `The above output had constraint violations. Fix them:\n${retryPrompt}` }
      ]
    };

    // Retry generation
    lastResult = await generateLayout(currentOptions);
    
    // Re-lint
    options.onProgress?.('Re-validating design constraints...');
    lastWarnings = lint(lastResult.data);
    
    console.log(`[Self-Correction] After retry ${retryCount}: ${lastWarnings.length} warning(s), ${lastWarnings.filter(w => w.severity === 'error').length} error(s)`);
  }

  const hasRemainingErrors = hasErrors(lastWarnings);
  
  if (hasRemainingErrors) {
    console.warn(`[Self-Correction] Max retries (${maxRetries}) reached with ${lastWarnings.filter(w => w.severity === 'error').length} remaining error(s)`);
  } else if (retryCount > 0) {
    console.log(`[Self-Correction] Success after ${retryCount} retry(ies)`);
  }

  return {
    ...lastResult,
    retryCount,
    finalWarnings: lastWarnings,
    hasRemainingErrors
  };
}
