
import { PromptDependencies, FeatureFlags } from '../../../types/context';
import { PROMPT_SECTION_REGISTRY } from './sectionRegistry';
import { isEnabled } from '../../../constants/featureFlags';

/**
 * Composes the final System Prompt by assembling active sections from the registry.
 * 
 * @param deps Explicit dependencies required by sections
 * @param extraContext Additional dynamic context (like isModifyMode, originalTextContent)
 * @returns The fully assembled system prompt string
 */
export function composeSystemPrompt(
    deps: PromptDependencies,
    extraContext: Record<string, any> = {}
): string {
    // 1. Gather Feature Flags
    const flags: FeatureFlags = {
        USE_TOKEN_SLOT_SYSTEM: isEnabled('USE_TOKEN_SLOT_SYSTEM'),
        // Add other flags as needed
    };

    // 2. Filter & Sort Sections
    const activeSections = PROMPT_SECTION_REGISTRY
        .filter(section => {
            // If enabled predicate exists, check it
            if (section.enabled) {
                return section.enabled(flags);
            }
            return true; // Default to enabled
        })
        .sort((a, b) => a.priority - b.priority);

    // 3. Build Content
    const parts = activeSections.map(section => {
        try {
           return section.builder(deps, extraContext);
        } catch (error) {
            console.error(`[PromptComposer] Error building section ${section.id}:`, error);
            return ''; // Fail safe: omission is better than crash
        }
    });

    // 4. Join with standardized separator
    const finalPrompt = parts.filter(Boolean).join('\n\n');
    
    // Debugging / Logging
    const effectiveSections = parts.filter(Boolean).length;
    const tokenEstimate = Math.ceil(finalPrompt.length / 4);
    console.log(`[PromptComposer] Generated prompt with ${effectiveSections}/${activeSections.length} active sections. ~${tokenEstimate} tokens.`);

    return finalPrompt;
}
