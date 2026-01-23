/**
 * @file featureFlags.ts
 * @description Feature Flag System - Control experimental features and rule toggles
 * 
 * [INPUT]:  None (static configuration)
 * [OUTPUT]: Boolean flags for feature control
 * [POS]:    Constants - used by postProcessor, UI, and other modules
 * 
 * Usage:
 *   import { FEATURE_FLAGS, isEnabled } from '../constants/featureFlags';
 *   if (isEnabled('DEBUG_MODE')) { ... }
 */

// ==========================================
// FEATURE FLAGS
// ==========================================

export const FEATURE_FLAGS = {
    // ==========================================
    // POSTPROCESSOR RULES - Core (Always On)
    // ==========================================
    RULE_BUTTON_HEIGHT: true,
    RULE_SCHEMA_VALIDATION: true,
    RULE_MAGIC_NUMBER_WIDTH: true,
    RULE_HORIZONTAL_CHILD_FILL: true,
    RULE_LINE_DIVIDER: true,

    // ==========================================
    // POSTPROCESSOR RULES - Stable (On by default)
    // ==========================================
    RULE_PRIMARY_ACTION_INFERENCE: true,
    RULE_DARK_BG_TEXT_CONTRAST: true,
    RULE_AVATAR_CORNER: true,
    RULE_CARD_MIN_PADDING: true,
    RULE_LINE_HEIGHT_AUTO: true,
    RULE_SHADOW_OPACITY_FIX: true,
    RULE_IOS_CORNER_SMOOTHING: true,

    // ==========================================
    // POSTPROCESSOR RULES - Experimental (Off by default)
    // ==========================================
    RULE_AGGRESSIVE_FILL_SIZING: false,
    RULE_AUTO_SEMANTIC_INFERENCE: false,

    // ==========================================
    // UI FEATURES
    // ==========================================
    DEBUG_MODE: false,              // Show DSL debug panel
    SHOW_CORRECTION_LOG: false,     // Log postProcessor corrections to console
    RULE_HIT_STATS: false,          // Track rule hit statistics
    A_B_TESTER_UI: false,           // Show A/B testing interface

    // ==========================================
    // EXPERIMENTAL FEATURES
    // ==========================================
    USE_SOLVER: false,               // Optimization-based layout solver (Phase 2)
    ICON_GENERATION: false,         // Auto-generate icons via AI
    SMART_COLOR_PALETTE: false,     // AI-powered color suggestions
    COMPONENT_LIBRARY_SYNC: false,  // Sync with Figma component library
    USE_SEMANTIC_SWAP: false,       // Swap generic frames with design system components (Alpha)

    // ==========================================
    // ARCHITECTURE V2 (Physics Engine Mode)
    // @see implementation_plan.md - Phase 0
    // ==========================================
    /** Master switch for V2 architecture. When enabled:
     *  - PostProcessor uses physics-only corrections
     *  - Design dictation rules are bypassed
     *  - LLM has full control over aesthetic decisions
     */
    USE_PHYSICS_ENGINE_V2: true,
    
    /** [V3 Architecture] When enabled, completely trust LLM semantic output.
     *  - If LLM provides semantic: "BUTTON", trust it completely
     *  - NO name-based fallback (naming-patterns.json deprecated)
     *  - Return 'DEFAULT' if LLM doesn't provide semantic
     *  @see PLAYBOOK.md Phase 1.1
     */
    TRUST_LLM_SEMANTIC_FIRST: true,

    /** [STRATEGY B] Token Slot System
     *  When enabled, uses Design Token Slot System (DTSS) for variant resolution.
     *  - LLM outputs `{ semantic: "BUTTON", variant: "compact" }`
     *  - TokenSlot resolves to concrete values: `{ height: 32, paddingH: 12 }`
     *  - Physics Engine (hMin/hMax) remains as safety net
     */
    USE_TOKEN_SLOT_SYSTEM: false,



    /** [Disable PostProcessor] When enabled:
     *  - Skips the rule-based post-processing engine.
     *  - Useful for testing raw LLM output fidelity while keeping Schema active.
     */
    DISABLE_POST_PROCESSOR: true,

    /** [JSON Output Mode] When enabled:
     *  - DSL specification section is DISABLED in prompt
     *  - System assumes LLM outputs JSON (via responseJsonSchema)
     *  - Reduces token usage by ~500 tokens
     *  @note Set to false only when using streaming/DSL fallback mode
     */
    USE_JSON_OUTPUT_MODE: true,

    /** [Tool Calling Disable] When enabled:
     *  - Disables Tool Calling (validate_icon, get_design_tokens, etc.)
     *  - Tests hypothesis H-BA: responseJsonSchema + tools conflict
     *  - Icon validation will be skipped
     *  @warning This is for debugging Tools + JSON Schema conflicts
     */
    DISABLE_TOOL_CALLING: true,

    /** [Self-Correction Disable] When enabled:
     *  - Disables the Self-Correction retry loop
     *  - First generation result is returned directly
     *  - Avoids empty response issues from context accumulation
     *  @warning This means lint errors will NOT trigger retries
     */
    DISABLE_SELF_CORRECTION: true,

    /** [Response Schema Disable] When enabled:
     *  - Disables responseJsonSchema constraint
     *  - LLM generates JSON based on Prompt guidance only
     *  - Tests hypothesis H-DS1: Schema reduces LLM to "JSON filler"
     *  @experiment E1: Pure Prompt vs Schema-constrained output
     */
    DISABLE_RESPONSE_SCHEMA: true,

} as const;

// ==========================================
// TYPE DEFINITIONS
// ==========================================

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

// ==========================================
// API
// ==========================================

/**
 * Check if a feature flag is enabled
 * @param flag - The feature flag to check
 * @returns true if enabled, false otherwise
 */
export function isEnabled(flag: FeatureFlag): boolean {
    return FEATURE_FLAGS[flag];
}

/**
 * Get all enabled flags (useful for debugging)
 */
export function getEnabledFlags(): FeatureFlag[] {
    return (Object.keys(FEATURE_FLAGS) as FeatureFlag[])
        .filter(flag => FEATURE_FLAGS[flag]);
}

/**
 * Get all disabled flags (useful for debugging)
 */
export function getDisabledFlags(): FeatureFlag[] {
    return (Object.keys(FEATURE_FLAGS) as FeatureFlag[])
        .filter(flag => !FEATURE_FLAGS[flag]);
}

// ==========================================
// RULE HIT STATISTICS (when RULE_HIT_STATS is enabled)
// ==========================================

const ruleHitStats = new Map<string, number>();

/**
 * Record a rule hit (call this from postProcessor)
 */
export function recordRuleHit(ruleName: string): void {
    if (!FEATURE_FLAGS.RULE_HIT_STATS) return;
    ruleHitStats.set(ruleName, (ruleHitStats.get(ruleName) || 0) + 1);
}

/**
 * Get rule hit statistics
 */
export function getRuleHitStats(): Record<string, number> {
    return Object.fromEntries(ruleHitStats);
}

/**
 * Reset rule hit statistics
 */
export function resetRuleHitStats(): void {
    ruleHitStats.clear();
}
