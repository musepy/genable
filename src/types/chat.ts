/**
 * @file chat.ts
 * @description Type definitions for the chat feature.
 */

export interface ThinkingData {
    designSystem: string;
    style: string;
    iconSource: string;
    constraints: string[];
    rationale?: string;
}

/**
 * Represents a single correction made by the post-processing layer.
 * Used to provide feedback to the LLM about why certain values were changed.
 */
export interface CorrectionLog {
    /** The property that was corrected (e.g., "layoutSizingHorizontal") */
    field: string;
    /** The original value from LLM output */
    original: string | undefined;
    /** The corrected value applied by post-processing */
    corrected: string;
    /** Human-readable explanation of why the correction was made */
    reason: string;
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    thinking?: ThinkingData;
    rawOutput?: string;
    /** Post-processing corrections applied to LLM output (P2 feature) */
    corrections?: CorrectionLog[];
}

export interface ChatFeedback extends Omit<ChatMessage, 'role'> {
    role: 'model';
}

