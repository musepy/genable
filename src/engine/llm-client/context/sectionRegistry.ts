import { PromptDependencies, PromptSection } from '../../../types/context';
import { JSON_FORMAT_RULES, DESIGN_AGENT_PERSONA_TEMPLATE, ICON_SEMANTIC_TEMPLATE } from '../../../constants/prompts';
import { renderTemplate } from './templateLoader';

// Role section template (embedded for build compatibility)
const ROLE_TEMPLATE = `You are an expert Figma UI designer. Your task is to generate production-ready, responsive Figma designs.

{{{formatRules}}}

### MODE: {{#if isModifyMode}}MODIFY EXISTING{{else}}CREATE NEW{{/if}} DESIGN
- Output nodes in a logical order (Parent before its children).
- Return ONLY the valid JSON array.`;

// ==========================================
// Section Builders
// ==========================================

function buildRoleSection(_deps: PromptDependencies, context: { isModifyMode: boolean }): string {
    return renderTemplate(ROLE_TEMPLATE, {
        isModifyMode: context?.isModifyMode ?? false,
        formatRules: JSON_FORMAT_RULES
    });
}

function buildDesignAgentSection(_deps: PromptDependencies): string {
    return renderTemplate(DESIGN_AGENT_PERSONA_TEMPLATE, {});
}

const CONSTRAINT_TEMPLATE = `
### OUTPUT CONSTRAINTS
1. **Adjacency List Strategy**: ALWAYS output a flat array.
2. **Flexible Values**: You may use direct hex codes (#RRGGBB) or design system tokens (e.g. "$primary") if provided. 
3. **Sizing**: Use "layoutSizingHorizontal" and "layoutSizingVertical".
4. **Format**: Return ONLY a valid JSON array. No markdown code blocks.`;

function buildConstraintSection(deps: PromptDependencies): string {
    return renderTemplate(CONSTRAINT_TEMPLATE, {
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
    return renderTemplate(ICON_SEMANTIC_TEMPLATE, {});
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

