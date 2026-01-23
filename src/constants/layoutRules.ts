/**
 * @file layoutRules.ts
 * @description Single Source of Truth for Layout Constants
 * 
 * This file centralizes all layout-related constants to ensure consistency
 * across contextBuilder, postProcessor, and main.ts.
 * 
 * ⚠️ MODIFICATION RULE: Pattern data is now externalized to JSON files.
 * Update src/config/*.json for pattern changes.
 */

import { isEnabled } from './featureFlags';
import { DesignSystemConfig, SemanticConstraint } from '../types/designSystem';


// ==========================================
// SEMANTIC CONSTRAINTS (GRIDS-aligned)
// Based on: Dayama et al. CHI 2020 "GRIDS: Interactive Layout Design with Integer Programming"
// These define wi_min, hi_min, etc. for semantic components
// ==========================================



/**
 * Get constraints for a semantic type, scoped by design system
 * 
 * Priority Order:
 * 1. DesignSystemConfig slot - Primary source
 * 2. Fallback: Generic constraints (if any)
 */
export function getSemanticConstraint(semantic: string, config?: DesignSystemConfig): SemanticConstraint | undefined {
    if (!config) return undefined;
    
    // Resolve alias using config
    const normalized = semantic.toUpperCase().trim();
    const resolvedSemantic = config.aliases.aliases[normalized] || normalized;
    
    // Get constraint from config
    return config.constraints.constraints[resolvedSemantic] || config.constraints.constraints['DEFAULT'] || undefined;
}

// ==========================================
// HELPER FUNCTIONS (V3 Core Only)
// ==========================================

/**
 * Check if a node is a divider LINE element (the actual 1px line, not the container)
 * Used by renderers to fix height of horizontal lines
 */
export function isDividerLine(name: string, parentName?: string, config?: DesignSystemConfig): boolean {
    const normalizedName = name.toLowerCase().trim();
    
    // Exclude patterns that contain "line" but aren't dividers
    let excludes = ['headline', 'outline', 'underline', 'timeline', 'online', 'offline'];
    if (config) {
        const patterns = config.patterns.patterns.NAMING_PATTERNS;
        excludes = patterns['divider_exclude'] || excludes;
    }

    if (excludes.some(p => normalizedName.includes(p))) {
        return false;
    }
    
    // Check if name indicates a line element
    const isLineElement = 
        normalizedName === 'line' ||
        normalizedName === 'divider' ||
        normalizedName.endsWith('line') ||
        normalizedName.endsWith('-line') ||
        normalizedName.endsWith('_line');
    
    return isLineElement;
}

// ==========================================
// UNIFIED SEMANTIC INFERENCE
// ==========================================

/**
 * Infer semantic type from node properties
 * This is the SINGLE SOURCE OF TRUTH for semantic inference
 * 
 * Architecture V3 (Pure Trust):
 * - Completely trust LLM's semantic output
 * - NO name-based fallback (naming-patterns.json deprecated)
 * - Return 'DEFAULT' if LLM didn't provide semantic
 * 
 * @param name - Node name (No longer used for inference in V3)
 * @param explicitSemantic - Explicit semantic type from LLM/props
 * @returns Resolved semantic type
 */
export function inferSemanticType(name: string, explicitSemantic?: string, config?: DesignSystemConfig): string {
    // V3 Architecture: Complete LLM trust
    if (explicitSemantic && explicitSemantic !== 'DEFAULT') {
        const normalized = explicitSemantic.toUpperCase().trim();
        return config?.aliases.aliases[normalized] || normalized;
    }
    
    // V3: No fallback to name-based inference
    return 'DEFAULT';
}

/**
 * Get semantic constraint and inferred semantic type together
 */
export function getSemanticInfo(name: string, explicitSemantic?: string, config?: DesignSystemConfig): {
    semantic: string;
    constraint: SemanticConstraint | undefined;
} {
    const semantic = inferSemanticType(name, explicitSemantic, config);
    const constraint = getSemanticConstraint(semantic, config);
    return { semantic, constraint };
}

