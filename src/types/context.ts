import { LibraryResource } from '../types';
import type { AgentBehaviorConfig } from '../engine/agent/agentBehaviorConfig';


export interface SelectionContext {
    hasSelection: boolean;
    nodes?: Array<{
        id: string;
        type: string;
        name: string;
        [key: string]: any;
    }>;
    serializedDSL?: string;
}

/**
 * Phase 4.6: Explicit Dependencies Interface
 * ==========================================
 * All external data that the prompt composer needs.
 * This enables: Pure Function, Easy Testing, Reproducible Results.
 */
export interface PromptDependencies {
    // [1] RAG Results (from RagService)
    ragResults: {
        prioritizedComponents: LibraryResource[];
        goldenTemplates: Array<{ name: string; description: string; dsl: unknown }>;
    };

    // [2] User Intent (Optional)
    intent?: {
        requiresLayoutKnowledge?: boolean;
        [key: string]: any;
    };

    // [3] Design System Context (Classic Manifest)
    designSystemContext: {
        skillName: string;           // Manifest Name
    };

    // [4] Figma Selection Context
    selectionContext?: SelectionContext;

    // [5] Global Context (Optional)
    globalContext?: {
        isModifyMode?: boolean;
        originalTextContent?: string;
    };

    // [6] Agent Behavior Config (from agentBehaviorConfig.ts)
    behaviorConfig?: AgentBehaviorConfig;

    // [7] Runtime Operation Log (Incremental Improvement #2)
    operationLog?: Array<{
        opId?: string;
        action: string;
        reason?: string;
        success: boolean;
        timestamp: number;
        error?: string;
        diffInfo?: string[];
    }>;

    // [8] Active Step (Incremental Improvement #4)
    activeStep?: {
        stepId: string;
        title: string;
        description?: string;
        action?: string;
        nodes?: string[];
        reasoning?: string;
    } | null;

    // [9] Plan Summary — used in VERIFICATION mode when activeStep is null
    planSummary?: string;
}

export interface Intent {
    requiresLayoutKnowledge?: boolean;
    [key: string]: any;
}

