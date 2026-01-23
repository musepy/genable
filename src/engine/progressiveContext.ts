/**
 * @file progressiveContext.ts
 * @description Progressive Context System - Determines context level based on intent complexity
 * 
 * [INPUT]:  User prompt, RecognizedIntent, retry flag
 * [OUTPUT]: Context level (1-4) and list of needed references
 * [POS]:    UI Thread - called before contextBuilder to determine what to include
 * 
 * Implements Progressive Disclosure pattern from prompt-engineering skill:
 * - Level 1: Simple modifications → minimal context
 * - Level 2: Component generation → add constraints
 * - Level 3: Page/layout generation → add reasoning steps + examples
 * - Level 4: Retry/failure recovery → maximum context with few-shot
 */

import { RecognizedIntent, IntentType } from '../knowledge/intentRecognizer';

// ==========================================
// Types
// ==========================================

export type ContextLevel = 1 | 2 | 3 | 4;

export interface ContextDecision {
    level: ContextLevel;
    references: ('layout-rules' | 'component-specs')[];
    reason: string;
}

// ==========================================
// Decision Logic
// ==========================================

/**
 * Determine context level based on intent and prompt complexity
 */
export function determineContextLevel(
    intent: RecognizedIntent,
    userPrompt: string,
    options: {
        isRetry?: boolean;
        hasSelection?: boolean;
        previousError?: string;
    } = {}
): ContextDecision {
    const { isRetry, hasSelection, previousError } = options;
    const promptLower = userPrompt.toLowerCase();

    // Level 4: Retry or explicit failure recovery
    if (isRetry || previousError) {
        return {
            level: 4,
            references: ['layout-rules', 'component-specs'],
            reason: 'Retry mode - maximum context for error recovery'
        };
    }

    // Complexity indicators
    const isPageRequest = 
        promptLower.includes('page') ||
        promptLower.includes('dashboard') ||
        promptLower.includes('screen') ||
        promptLower.includes('layout') ||
        promptLower.includes('界面') ||
        promptLower.includes('页面');

    const isComplexLayout =
        promptLower.includes('grid') ||
        promptLower.includes('sidebar') ||
        promptLower.includes('navigation') ||
        promptLower.includes('multiple') ||
        promptLower.includes('columns') ||
        userPrompt.length > 300; // Long prompts usually mean complex requests

    const isSimpleModify =
        intent.type === 'MODIFY_EXISTING' ||
        intent.type === 'APPLY_STYLE' ||
        (hasSelection && userPrompt.length < 50);

    // Decision Tree
    if (isSimpleModify) {
        return {
            level: 1,
            references: [],
            reason: 'Simple modification - minimal context'
        };
    }

    if (intent.type === 'CONVERT_COMPONENT' && intent.target) {
        return {
            level: 2,
            references: ['component-specs'],
            reason: `Converting to ${intent.target} - include component specs`
        };
    }

    if (intent.type === 'GENERATE_COMPONENT' && !isPageRequest) {
        const refs: ('layout-rules' | 'component-specs')[] = [];
        if (intent.target) refs.push('component-specs');
        
        return {
            level: 2,
            references: refs,
            reason: 'Component generation - standard constraints'
        };
    }

    if (isPageRequest || isComplexLayout) {
        return {
            level: 3,
            references: ['layout-rules', 'component-specs'],
            reason: 'Page/complex layout - full context with layout rules'
        };
    }

    // Default to Level 2 for unknown cases
    return {
        level: 2,
        references: ['layout-rules'],
        reason: 'Default - standard constraints'
    };
}

/**
 * Get prompt length estimate based on level
 */
export function estimatePromptTokens(level: ContextLevel): number {
    const estimates: Record<ContextLevel, number> = {
        1: 200,   // Minimal
        2: 500,   // Standard
        3: 1000,  // Full
        4: 2000   // Maximum
    };
    return estimates[level];
}

/**
 * Check if we should escalate level based on previous output quality
 */
export function shouldEscalateLevel(
    currentLevel: ContextLevel,
    validationIssues: string[]
): ContextDecision | null {
    if (validationIssues.length === 0) return null;

    const newLevel = Math.min(4, currentLevel + 1) as ContextLevel;
    
    // Determine which references to add based on issues
    const references: ('layout-rules' | 'component-specs')[] = [];
    
    const hasLayoutIssue = validationIssues.some(issue => 
        issue.includes('width') || 
        issue.includes('FILL') || 
        issue.includes('sizing') ||
        issue.includes('layout')
    );
    
    const hasComponentIssue = validationIssues.some(issue =>
        issue.includes('height') ||
        issue.includes('padding') ||
        issue.includes('button') ||
        issue.includes('avatar')
    );

    if (hasLayoutIssue) references.push('layout-rules');
    if (hasComponentIssue) references.push('component-specs');
    if (references.length === 0) references.push('layout-rules', 'component-specs');

    return {
        level: newLevel,
        references,
        reason: `Escalated due to ${validationIssues.length} validation issues`
    };
}
