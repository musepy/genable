/**
 * @file flowObserver.ts
 * @description Centralized lifecycle observer for tracing the AI generation pipeline.
 * 
 * Provides structured logging for:
 * 1. PROMPT - Construction details
 * 2. LLM_RESPONSE - Raw and parsed output
 * 3. POST_PROCESS - Rules matched and corrections applied
 * 4. RENDER - Figma node creation metrics
 * 5. SWAP - Semantic component instance replacements
 */

export enum FlowPhase {
    PROMPT = 'PROMPT',
    LLM_RESPONSE = 'LLM_RESPONSE',
    POST_PROCESS = 'POST_PROCESS',
    RENDER = 'RENDER',
    SWAP = 'SWAP',
    // P3.1 Diagnostic Phases
    SCHEMA_WARNING = 'SCHEMA_WARNING',
    LAYOUT_CONFLICT = 'LAYOUT_CONFLICT',
    SEMANTIC_MISSING = 'SEMANTIC_MISSING'
}

export interface TraceEvent {
    phase: FlowPhase;
    message: string;
    details?: any;
    timestamp: number;
}

export class FlowObserver {
    private static instance: FlowObserver;
    private traceId: string = '';
    private events: TraceEvent[] = [];

    private constructor() {}

    public static getInstance(): FlowObserver {
        if (!FlowObserver.instance) {
            FlowObserver.instance = new FlowObserver();
        }
        return FlowObserver.instance;
    }

    /**
     * Start a new trace session or resume an existing one
     */
    public startTrace(id?: string): string {
        this.traceId = id || Math.random().toString(36).substring(2, 9).toUpperCase();
        this.events = [];
        this.log(FlowPhase.PROMPT, `${id ? 'Resuming' : 'Starting new'} generation trace: ${this.traceId}`);
        return this.traceId;
    }

    /**
     * Get current trace ID
     */
    public getTraceId(): string {
        return this.traceId;
    }

    /**
     * Record a lifecycle event
     */
    public log(phase: FlowPhase, message: string, details?: any): void {
        const event: TraceEvent = {
            phase,
            message,
            details,
            timestamp: Date.now()
        };
        this.events.push(event);

        // Immediate Console Output for transparency
        const prefix = `[Trace: ${this.traceId}] PHASE: [${phase}]`;
        console.log(`${prefix} - ${message}`);
        if (details) {
            console.log(`${prefix} - Details:`, details);
        }
    }

    /**
     * Get the current trace summary for reporting
     */
    public getSummary(): string {
        const counts = this.events.reduce((acc: any, e) => {
            acc[e.phase] = (acc[e.phase] || 0) + 1;
            return acc;
        }, {});

        return `Trace ${this.traceId} Summary: PROMPT(${counts.PROMPT || 0}) LLM(${counts.LLM_RESPONSE || 0}) POST(${counts.POST_PROCESS || 0}) RENDER(${counts.RENDER || 0}) SWAP(${counts.SWAP || 0})`;
    }

    /**
     * Export all events for deep debugging
     */
    public exportTrace(): TraceEvent[] {
        return [...this.events];
    }
}

export const flowObserver = FlowObserver.getInstance();
