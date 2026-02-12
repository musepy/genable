import { PromptDependencies, PromptSection } from '../../../types/context';
import {
    SCHEMA_RULES,
    DESIGN_AESTHETICS,
    ICON_USAGE,
    LINEAR_ROLE_TEMPLATE,
    LINEAR_CONSTRAINT_TEMPLATE,
} from '../../prompt/promptRegistry';
import { renderTemplate } from './templateLoader';

// ==========================================
// Section Builders
// ==========================================

function buildRoleSection(_deps: PromptDependencies, context: { isModifyMode: boolean }): string {
    return renderTemplate(LINEAR_ROLE_TEMPLATE, {
        isModifyMode: context?.isModifyMode ?? false,
        formatRules: SCHEMA_RULES
    });
}

function buildDesignAgentSection(_deps: PromptDependencies): string {
    return renderTemplate(DESIGN_AESTHETICS, {});
}

function buildConstraintSection(deps: PromptDependencies): string {
    return renderTemplate(LINEAR_CONSTRAINT_TEMPLATE, {
        exampleColor: '#CCCCCC',
        exampleSpacing: 8
    });
}

const ORIGINAL_CONTENT_TEMPLATE = `{{#if originalTextContent}}
ORIGINAL TEXT CONTENT: "{{originalTextContent}}"
CRITICAL: You MUST include a TEXT node with this exact content in your output. Do not use placeholder text like "Label" or "Button".
{{/if}}`;

function buildOriginalContentSection(_deps: PromptDependencies, context: { originalTextContent?: string }): string {
    return renderTemplate(ORIGINAL_CONTENT_TEMPLATE, {
        originalTextContent: context?.originalTextContent || null
    });
}

function buildIconSection(deps: PromptDependencies): string {
    // [Pure Trust] Always use Semantic Naming strategy.
    // Explicit allowlists proved too brittle and were unused.
    return renderTemplate(ICON_USAGE, {});
}

// ==========================================
// Registry Definition
// ==========================================

export const PROMPT_SECTION_REGISTRY: PromptSection[] = [
    {
        id: 'role',
        priority: 10,
        dependencies: [],
        builder: buildRoleSection
    },
    {
        id: 'design-agent-persona',
        priority: 11, // Just after role
        dependencies: [],
        builder: buildDesignAgentSection
    },
    {
        id: 'constraints',
        priority: 15,
        dependencies: [],
        builder: buildConstraintSection
    },
    {
        id: 'original-content',
        priority: 46,
        dependencies: [],
        builder: buildOriginalContentSection
    },
    {
        id: 'icons',
        priority: 85,
        dependencies: [], // No explicit deps needed for semantic template
        builder: buildIconSection,
    }
];
