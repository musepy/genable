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

export interface ToolCallRecord {
    id: string;
    name: string;
    parameters: any;
    status: 'pending' | 'running' | 'success' | 'error';
    startTime: number;
    endTime?: number;
    result?: any;
    error?: string;
}

export interface LLMCallRecord {
    llmCallId: string;
    iteration: number;
    startTime: number;
    endTime?: number;
    durationMs?: number;
    messageCount: number;
    toolNames: string[];
    config: {
        maxOutputTokens: number;
        thinkingLevel: string;
        toolMode: string;
    };
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    responseShape?: {
        textLength: number;
        thoughtsLength: number;
        toolCallCount: number;
        toolCallNames: string[];
    };
    success?: boolean;
}

export interface IterationRecord {
    iteration: number;
    thinking: string;
    startTime: number;
    endTime?: number;
    toolCallIds?: string[];
    /** Linked task ID from planState */
    taskId?: string;
    /** Current task title for UI display */
    taskTitle?: string;
}

// ============================================
// Content blocks — vertical stream of text + tool groups
// ============================================

export type ContentBlock =
    | { type: 'text'; content: string }
    | { type: 'tool_group'; tools: ToolCallRecord[] };

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    /** Context attachments (page, selection, skill) submitted with this message */
    attachments?: import('../types').ContextAttachment[];
    /** Chronological stream of text and tool blocks (new rendering model) */
    blocks?: ContentBlock[];
    thinking?: ThinkingData;
    rawOutput?: string;
    /** Post-processing corrections applied to LLM output (P2 feature) */
    corrections?: CorrectionLog[];
    /** Tool execution records for this response (Phase 1) */
    toolCalls?: ToolCallRecord[];
    /** LLM call records for this response */
    llmCalls?: LLMCallRecord[];
    /** Reasoning iterations for this response (Phase 2) */
    iterations?: IterationRecord[];
    /** Whether the message is currently being streamed/generated */
    streaming?: boolean;
    /** When this message generation started */
    startTime?: number;
    /** When this message generation finished */
    endTime?: number;
    /** Terminal state for historical display */
    runState?: 'idle' | 'running' | 'completed' | 'canceled' | 'error' | 'reconnecting';
    /** Error message, if any */
    runError?: string;
    /** Error code for routing (e.g. 'RATE_LIMIT_EXHAUSTED') */
    runErrorCode?: string;
    /** Whether the agent exhausted its iteration budget (elastic iterations) */
    budgetExhausted?: boolean;
    /** Post-run agent debrief (collected after difficult runs) */
    debrief?: {
        exitReason: string;
        text: string;
        structured?: { confusingTools: string[]; hardParts: string[]; suggestions: string[] };
    };
    /** Stable identifier for DOM reconciliation */
    id: string;
}

export interface ChatFeedback extends Omit<ChatMessage, 'role'> {
    role: 'model';
}
