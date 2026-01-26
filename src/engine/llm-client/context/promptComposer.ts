import { PromptDependencies } from '../../../types/context';
import { PROMPT_SECTION_REGISTRY } from './sectionRegistry';
import { configManager } from '../../../config/configManager';

export function composeSystemPrompt(
    deps: PromptDependencies,
    extraContext: Record<string, any> = {}
): string {
    // 1. Resolve State from Config & Context
    const activeFlags: Record<string, boolean> = {
        USE_TOKEN_SLOT_SYSTEM: configManager.isEnabled('USE_TOKEN_SLOT_SYSTEM'),
        USE_PHYSICS_ENGINE_V2: configManager.isEnabled('USE_PHYSICS_ENGINE_V2'),
        TRUST_LLM_SEMANTIC_FIRST: configManager.isEnabled('TRUST_LLM_SEMANTIC_FIRST')
    };

    // 2. Filter & Sort Sections
    const activeSections = PROMPT_SECTION_REGISTRY
        .filter((section: any) => {
            // If enabled predicate exists, check it
            if (section.enabled) {
                return section.enabled(activeFlags as any);
            }
            return true; // Default to enabled
        })
        .sort((a: any, b: any) => a.priority - b.priority);

    // 3. Build Content
    const parts = activeSections.map((section: any) => {
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
