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
    } | null;
}

export interface Intent {
    requiresLayoutKnowledge?: boolean;
    [key: string]: any;
}

/**
 * Feature Flags interface (can be expanded based on actual flags)
 */
export interface FeatureFlags {
    USE_TOKEN_SLOT_SYSTEM?: boolean;
    [key: string]: boolean | undefined;
}

/**
 * A declarative section of the system prompt.
 */
export interface PromptSection {
    id: string; // Unique identifier
    priority: number; // Lower number = Higher priority (appears earlier)
    dependencies: string[]; // List of dependency keys for documentation/debugging
    /**
     * Builder function to generate the section string.
     * Returns empty string if the section should be skipped.
     */
    builder: (deps: PromptDependencies, extraContext?: any) => string;
    /**
     * Optional condition to enable/disable this section based on flags
     */
    enabled?: (flags: FeatureFlags) => boolean;
}
