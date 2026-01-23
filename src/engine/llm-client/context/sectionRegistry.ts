
import { PromptDependencies, PromptSection, FeatureFlags } from '../../../types/context';
import { isEnabled } from '../../../constants/featureFlags';

import { PROPS, NODE_TYPES } from '../../../constants/figma-api';
import { ICON_SEMANTIC_TEMPLATE } from '../../../constants/prompts';
import { renderTemplate } from './templateLoader';
import { knowledgeHub, ReasoningRule, TypographyPairing, StyleDefinition, LandingPagePattern, ANATOMY_REGISTRY, FigmaLayoutRule, AnatomyBlueprint } from '../knowledge/knowledgeHub';


// Role section template (embedded for build compatibility)
const ROLE_TEMPLATE = `You are an expert Figma UI designer. Your task is to generate production-ready, responsive Figma designs using a FLAT ADJACENCY LIST format.

### MODE: {{#if isModifyMode}}MODIFY EXISTING{{else}}CREATE NEW{{/if}} DESIGN
- Output format: Flat array of JSON objects with "id" and "parent" properties.
- This creates a robust hierarchy that avoids nesting syntax errors and truncation failures.

### RELATIONSHIP SCHEMA
Each node object must have:
- "id": A unique string (e.g., "hero-section", "hero-title").
- "parent": The "id" of its containing node, or null if it's the root.
- "type": The Figma node type.
- "props": Aesthetic and layout properties.

### CRITICAL RULES
1. **NO NESTING**: NEVER use a "children" property. All relationships must be via "id" and "parent" references in a flat list.
2. **ORDER**: Output nodes in a logical order (Parent before its children).
3. **CONTENT**: Every TEXT node MUST have "{{PROPS_characters}}" with actual text.
4. Return ONLY valid JSON array.`;

// ==========================================
// Section Builders
// ==========================================

function buildRoleSection(_deps: PromptDependencies, context: { isModifyMode: boolean }): string {
    return renderTemplate(ROLE_TEMPLATE, {
        isModifyMode: context?.isModifyMode ?? false
    });
}

const CONSTRAINT_TEMPLATE = `
### OUTPUT CONSTRAINTS
1. **Adjacency List Strategy**: Output a flat array. To build a hierarchy, create a container node (e.g. id: "card") and then children nodes (e.g. id: "card-title", parent: "card").
2. **Flexible Values**: You may use direct hex codes (#RRGGBB) or design system tokens (e.g. "$primary", "$space-4") if provided in the context. 
3. **Layout Sizing Properties**: 
   - Use "layoutSizingHorizontal" and "layoutSizingVertical" (values: "FIXED", "HUG", "FILL")
   - DO NOT use "primaryAxisSizingMode" or "counterAxisSizingMode"
4. **Hierarchy**: Ensure every container has at least one child node pointing to it as its parent.
5. **Format**: Return ONLY a valid JSON array. No prose.`;

function buildConstraintSection(deps: PromptDependencies): string {
    return renderTemplate(CONSTRAINT_TEMPLATE, {
        exampleColor: '#CCCCCC',
        exampleSpacing: 8
    });
}

// ==========================================
// Figma Layout Rules Section (Dynamic from knowledgeHub)
// [H-H Implementation] - Dynamic rule injection from knowledge base
// ==========================================

const FIGMA_LAYOUT_TEMPLATE = `
### FIGMA LAYOUT RULES (Critical Do/Don't)
{{#each rules}}
- **{{issue}}**: DO: {{do}} | DON'T: {{dont}}
{{/each}}

CRITICAL: Follow these layout rules exactly to avoid rendering issues.`;

function buildFigmaLayoutSection(deps: PromptDependencies): string {
    const target = deps.intent?.target || '';

    // Search for rules relevant to the target component
    // If no target, get general critical rules
    const searchQuery = target || 'layout card button text';
    const results = knowledgeHub.searchFigmaLayout(searchQuery, 5);

    // Always include highest severity rules
    const allRules = knowledgeHub.getAllFigmaLayoutRules();
    const criticalRules = allRules.filter(r => r.severity === 'Critical' || r.severity === 'High');

    // Merge search results with critical rules, dedupe by id
    const mergedRules = [...results.map(r => r.item)];
    for (const rule of criticalRules) {
        if (!mergedRules.some(r => r.id === rule.id)) {
            mergedRules.push(rule);
        }
    }

    // Limit to 7 rules max to avoid prompt bloat
    const finalRules = mergedRules.slice(0, 7);

    if (finalRules.length === 0) return '';

    return renderTemplate(FIGMA_LAYOUT_TEMPLATE, {
        rules: finalRules
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



// [DEPRECATED] buildKnowledgeSection removed - now served by buildStructuralAnatomySection



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
        id: 'constraints',
        priority: 15,
        dependencies: [],
        builder: buildConstraintSection
    },
    {
        id: 'figma-layout-rules',
        priority: 17,
        dependencies: ['intent'],
        builder: buildFigmaLayoutSection,
        // Always enabled - critical for correct output
        enabled: () => true
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
    },
    // [DEPRECATED] knowledge-base section removed - unified into structural-anatomy
    // Original SHADCN_PRESET injection is now handled by buildStructuralAnatomySection
    // {
    //     id: 'knowledge-base',
    //     priority: 45,
    //     dependencies: ['intent'],
    //     builder: buildKnowledgeSection
    // },
    {
        id: 'color-context',
        priority: 41,
        dependencies: ['intent'],
        builder: buildColorContextSection,
    },
    {
        id: 'reasoning-context',
        priority: 42,
        dependencies: ['intent'],
        builder: buildReasoningContextSection,
    },
    {
        id: 'typography-context',
        priority: 43,
        dependencies: ['intent'],
        builder: buildTypographyContextSection,
    },
    {
        id: 'style-context',
        priority: 44,
        dependencies: ['intent'],
        builder: buildStyleContextSection,
    },
    {
        id: 'landing-patterns',
        priority: 47,
        dependencies: ['intent'],
        builder: buildLandingPatternSection,
    },
    {
        id: 'structural-anatomy',
        priority: 47.5,
        dependencies: ['intent'],
        builder: buildStructuralAnatomySection,
    },
    {
        id: 'chart-context',
        priority: 48,
        dependencies: ['intent'],
        builder: buildChartContextSection,
    },
    {
        id: 'product-context',
        priority: 49,
        dependencies: ['intent'],
        builder: buildProductContextSection,
    },
    {
        id: 'guideline-context',
        priority: 50,
        dependencies: ['intent'],
        builder: buildGuidelineContextSection,
    },
    {
        id: 'stack-context',
        priority: 51,
        dependencies: ['designSystemContext'],
        builder: buildStackContextSection,
    }
];

// ==========================================
// Reasoning Context Section (ReasoningEngine Integration)
// ==========================================

const REASONING_CONTEXT_TEMPLATE = `
### DESIGN REASONING (Context-Aware Rules)
Apply these design principles based on the inferred industry:

{{#if pattern}}**Recommended Pattern:** {{pattern}}{{/if}}
{{#if colorMood}}**Color Mood:** {{colorMood}}{{/if}}
{{#if typographyMood}}**Typography Mood:** {{typographyMood}}{{/if}}
{{#if keyEffects}}**Key Effects:** {{keyEffects}}{{/if}}
{{#if antiPatterns}}**Avoid:** {{antiPatterns}}{{/if}}
{{#if stylePriority}}**Style Priority:** {{stylePriority}}{{/if}}
`;

function buildReasoningContextSection(deps: PromptDependencies): string {
    const { intent } = deps;
    const query = intent.target || intent.type || '';
    if (!query) return '';

    const results = knowledgeHub.searchReasoning(query, 1);
    if (results.length === 0 || results[0].score < 0.4) return '';

    const topRule = results[0].item;

    return renderTemplate(REASONING_CONTEXT_TEMPLATE, {
        pattern: topRule.pattern,
        colorMood: topRule.colorMood,
        typographyMood: topRule.typographyMood,
        keyEffects: topRule.keyEffects,
        antiPatterns: topRule.antiPatterns,
        stylePriority: topRule.stylePriority.join(' + ')
    });
}

const TYPOGRAPHY_CONTEXT_TEMPLATE = `
### TYPOGRAPHY PAIRING (UX Pro Max)
Use this curated typography strategy:
- **Heading Font:** {{headingFont}}
- **Body Font:** {{bodyFont}}
- **Notes:** {{notes}}
`;

function buildTypographyContextSection(deps: PromptDependencies): string {
    const { intent } = deps;
    const query = intent.target || '';
    if (!query) return '';

    const results = knowledgeHub.searchTypography(query, 1);
    if (results.length === 0 || results[0].score < 0.3) return '';

    const pairing = results[0].item;
    return renderTemplate(TYPOGRAPHY_CONTEXT_TEMPLATE, {
        headingFont: pairing.headingFont,
        bodyFont: pairing.bodyFont,
        notes: pairing.notes
    });
}

const STYLE_CONTEXT_TEMPLATE = `
### VISUAL STYLE GUIDELINES
{{#if primaryColors}}**Primary Palette:** {{primaryColors}}{{/if}}
{{#if effects}}**Effects (Shadows/Elevation):** {{effects}}{{/if}}
{{#if bestFor}}**Best For:** {{bestFor}}{{/if}}
`;

function buildStyleContextSection(deps: PromptDependencies): string {
    const { intent } = deps;
    const query = intent.modifiers.variant || intent.target || '';
    if (!query) return '';

    const results = knowledgeHub.searchStyles(query, 1);
    if (results.length === 0 || results[0].score < 0.3) return '';

    const style = results[0].item;
    return renderTemplate(STYLE_CONTEXT_TEMPLATE, {
        primaryColors: style.primaryColors,
        effects: style.effects,
        bestFor: style.bestFor
    });
}

const COLOR_CONTEXT_TEMPLATE = `
### PRODUCT COLOR PALETTE
Use these specific brand colors for the design:
{{#each colors}}
- **{{type}}**: {{value}} ({{description}})
{{/each}}
CRITICAL: Map these hex codes to appropriate semantic slots (e.g. {{colors.[0].value}} for Primary background).
`;

function buildColorContextSection(deps: PromptDependencies): string {
    const { intent } = deps;
    const query = intent.target || intent.type || '';
    if (!query) return '';

    const results = knowledgeHub.searchColors(query, 5);
    if (results.length === 0) return '';

    return renderTemplate(COLOR_CONTEXT_TEMPLATE, {
        colors: results.map(r => r.item)
    });
}

const LANDING_PATTERN_TEMPLATE = `
### LANDING PAGE STRUCTURE
Detected a landing/marketing page request. Apply these patterns:
- **Recommended Sections:** {{sections}}
- **Call to Action Strategy:** {{cta}}
- **Conversion Optimization:** {{conversion}}
`;

function buildLandingPatternSection(deps: PromptDependencies): string {
    const { intent } = deps;
    const query = intent.target || '';

    // Only trigger if intent looks like a landing page
    const isLanding = ['landing', 'hero', 'home', 'marketing'].some(k => query.toLowerCase().includes(k));
    if (!isLanding) return '';

    const results = knowledgeHub.searchLanding(query, 1);
    if (results.length === 0) return '';

    const landing = results[0].item;
    return renderTemplate(LANDING_PATTERN_TEMPLATE, {
        sections: landing.sections,
        cta: landing.cta,
        conversion: landing.conversion
    });
}

const CHART_CONTEXT_TEMPLATE = `
### CHART RECOMMENDATIONS (Data Visualization)
Detected data-heavy intent. Use these specifications:
- **Best Chart Type:** {{bestChart}}
- **Alternative Options:** {{secondaryOptions}}
- **Color Strategy:** {{colors}}
- **Performance:** {{performance}}
- **Library:** {{library}}
`;

function buildChartContextSection(deps: PromptDependencies): string {
    const { intent } = deps;
    const query = intent.target || '';
    const isChart = ['chart', 'graph', 'data', 'stats', 'analytics', 'dashboard'].some(k => query.toLowerCase().includes(k));
    if (!isChart) return '';

    const results = knowledgeHub.searchCharts(query, 1);
    if (results.length === 0 || results[0].score < 0.3) return '';

    const chart = results[0].item;
    return renderTemplate(CHART_CONTEXT_TEMPLATE, {
        bestChart: chart.bestChart,
        secondaryOptions: chart.secondaryOptions,
        colors: chart.colors,
        performance: chart.performance,
        library: chart.library
    });
}

const PRODUCT_CONTEXT_TEMPLATE = `
### INDUSTRY TRENDS & BEST PRACTICES
- **Market Segment:** {{type}}
- **Visual Style Recommendation:** {{primaryStyle}}
- **Key Considerations:** {{considerations}}
`;

function buildProductContextSection(deps: PromptDependencies): string {
    const { intent } = deps;
    const query = intent.target || '';
    if (!query) return '';

    const results = knowledgeHub.searchProducts(query, 1);
    if (results.length === 0 || results[0].score < 0.4) return '';

    const product = results[0].item;
    return renderTemplate(PRODUCT_CONTEXT_TEMPLATE, {
        type: product.type,
        primaryStyle: product.primaryStyle,
        considerations: product.considerations
    });
}

const GUIDELINE_CONTEXT_TEMPLATE = `
### UX & IMPLEMENTATION GUIDELINES
{{#each rules}}
- [{{severity}}] **{{issue}}**: {{description}}
  - **Do:** {{do}}
  - **Don't:** {{dont}}
{{/each}}
`;

function buildGuidelineContextSection(deps: PromptDependencies): string {
    const { intent } = deps;
    const query = intent.target || intent.type || '';
    if (!query) return '';

    const results = knowledgeHub.searchGuidelines(query, 3);
    if (results.length === 0) return '';

    return renderTemplate(GUIDELINE_CONTEXT_TEMPLATE, {
        rules: results.map(r => r.item)
    });
}

const STACK_CONTEXT_TEMPLATE = `
### TECHNICAL STACK CONSTRAINTS ({{stackName}})
{{#each rules}}
- **{{guideline}}**: {{description}}
  - **Proper Syntax:** \`{{codeGood}}\`
{{/each}}
`;

function buildStackContextSection(deps: PromptDependencies): string {
    const stack = deps.designSystemContext.skillName;
    if (!stack) return '';

    const results = knowledgeHub.searchStackRules(stack, '', 3);
    if (results.length === 0) return '';

    return renderTemplate(STACK_CONTEXT_TEMPLATE, {
        stackName: stack,
        rules: results.map(r => r.item)
    });
}

const STRUCTURAL_ANATOMY_TEMPLATE = `
### STRUCTURAL ANATOMY BLUEPRINT
Follow this exact node hierarchy and style for {{patternName}}:
- **Anatomy**: {{{anatomy}}}
- **Base Props**: {{{baseProps}}}
- **Available Variants**: {{{variants}}}
CRITICAL: Use these specific node IDs, parent relationships, and variant-specific properties to ensure design system compliance.
`;

function buildStructuralAnatomySection(deps: PromptDependencies): string {
    const { intent } = deps;
    const query = intent.target || '';
    if (!query) return '';

    // Use knowledgeHub RAG for semantic search instead of direct key matching
    const results = knowledgeHub.searchAnatomy(query, 1);
    
    if (results.length === 0) {
        // Fallback: If intent identified a chart but no specific blueprint, 
        // try to find a generic one
        const isChart = ['chart', 'graph', 'data', 'stat', 'analytics'].some(k => query.toLowerCase().includes(k));
        if (isChart) {
            const chartResults = knowledgeHub.searchAnatomy('chart', 1);
            if (chartResults.length > 0) {
                return buildSection(chartResults[0].item);
            }
        }
        return '';
    }

    const blueprint = results[0].item;
    console.log(`[AnatomyDebug] Query: "${query}", Found: "${blueprint.id}" (score: ${results[0].score})`);

    return buildSection(blueprint);

    function buildSection(blueprint: AnatomyBlueprint): string {
        // [Pure Trust] Blueprints are returned in their original state. 
        // No stripping of style or layout properties is performed.
        return renderTemplate(STRUCTURAL_ANATOMY_TEMPLATE, {
            patternName: blueprint.name || blueprint.id,
            anatomy: JSON.stringify(blueprint.structure),
            baseProps: JSON.stringify(blueprint.defaultProps || {}),
            variants: blueprint.variants ? JSON.stringify(blueprint.variants) : 'N/A'
        });
    }
}

// [DEPRECATED] stripStyle removed to preserve original anatomy DNA.
