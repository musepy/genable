/**
 * @file chat.ts
 * @description Type definitions for the chat feature.
 */

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
    /** Tool execution records for this response */
    toolCalls?: ToolCallRecord[];
    /** Reasoning iterations for this response */
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
