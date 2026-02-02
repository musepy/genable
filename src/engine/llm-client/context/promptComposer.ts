import { PromptDependencies } from '../../../types/context';
import { PROMPT_SECTION_REGISTRY } from './sectionRegistry';
import { configManager } from '../../../config/configManager';
import { ToolDefinition } from '../../agent/tools/types';
import { NodeSerializer } from '../../figma-adapter/nodeSerializer';
import { 
    AGENT_IDENTITY, 
    AGENT_THINKING_PROTOCOL, 
    DYNAMIC_GUIDANCE, 
    AGENT_NAMING_CONVENTION, 
    AGENT_CONTENT_REQUIREMENT 
} from '../../agent/agentPrompts';

// ==========================================
// Agent Mode Section Registry
// ==========================================

export type AgentMode = 'PLANNING' | 'EXECUTION' | 'VERIFICATION';

/**
 * Feature flags for Agent mode prompt sections.
 */
interface AgentFeatureFlags {
    INJECT_KNOWLEDGE?: boolean;
    USE_EXTENDED_EXAMPLES?: boolean;
}

/**
 * Agent-specific prompt section definition.
 */
interface AgentPromptSection {
    id: string;
    priority: number;
    builder: (deps: PromptDependencies, tools: ToolDefinition[], budget: number, mode?: AgentMode) => string;
    enabled?: (flags: AgentFeatureFlags) => boolean;
    budgetKey: keyof TokenBudget;
}

/**
 * Token budget allocation for agent system prompt composition.
 * Defines the maximum tokens allowed for each section, prioritized by importance.
 */
interface TokenBudget {
    core: number;      // 身份 (不可压缩)
    tools: number;     // 工具定义
    examples: number;  // 完整示例
    context: number;   // RAG 知识 (可压缩)
    selection: number; // 当前选择 (可截断)
}

/**
 * Proportional allocation for token budget.
 * Values are ratios of the total available context window.
 */
interface TokenRatios {
    core: number;
    tools: number;
    examples: number;
    context: number;
    selection: number;
}

const DEFAULT_TOKEN_RATIOS: TokenRatios = {
    core: 0.2,      // 20% for identity & instructions
    tools: 0.15,    // 15% for tool definitions
    examples: 0.3,  // 30% for examples
    context: 0.2,   // 20% for RAG knowledge
    selection: 0.15 // 15% for current selection
};

/**
 * Default token budget configuration.
 * Total: 4800 tokens
 */
const DEFAULT_TOKEN_BUDGET: TokenBudget = {
    core: 1000,      // 身份 + 工具格式（不可压缩）
    tools: 800,      // 工具定义
    examples: 1500,  // 完整示例（高优先级）
    context: 1000,   // RAG 知识（可压缩）
    selection: 500,  // 当前选择（可截断）
};

const SECTION_PRIORITY: (keyof TokenBudget)[] = ['core', 'tools', 'examples', 'context', 'selection'];

/**
 * Liquid Budgeting: Calculates dynamic token allocations based on priorities.
 * If a high-priority section doesn't use its full share, the surplus flows to the next section.
 */
function calculateLiquidBudget(
    totalBudget: number,
    ratios: TokenRatios,
    priorities: (keyof TokenBudget)[] = SECTION_PRIORITY
): TokenBudget {
    const budget: { [key in keyof TokenBudget]: number } = {
        core: 0,
        tools: 0,
        examples: 0,
        context: 0,
        selection: 0,
    };
    let remainingTokens = totalBudget;

    // First pass: Allocate based on ratios, ensuring no section exceeds its proportional share
    // and tracking potential surplus from sections that might not need their full share.
    const initialAllocations: { [key in keyof TokenBudget]: number } = {
        core: 0,
        tools: 0,
        examples: 0,
        context: 0,
        selection: 0,
    };

    let totalRatioSum = 0;
    for (const key of priorities) {
        totalRatioSum += ratios[key];
    }

    // Distribute based on ratios
    for (const key of priorities) {
        initialAllocations[key] = Math.floor(totalBudget * (ratios[key] / totalRatioSum));
        budget[key] = initialAllocations[key];
        remainingTokens -= budget[key];
    }

    // Second pass: Distribute remaining tokens to sections based on priority
    // This simulates "liquid" budgeting where surplus flows to lower priority sections.
    // For simplicity here, we distribute remaining tokens proportionally to remaining ratios.
    // A more complex liquid budget would involve knowing actual content size, which happens later.
    // For now, this ensures all tokens are distributed.
    if (remainingTokens > 0) {
        let currentRatioSum = 0;
        for (const key of priorities) {
            currentRatioSum += ratios[key];
        }

        for (const key of priorities) {
            if (currentRatioSum > 0) {
                const additionalAllocation = Math.floor(remainingTokens * (ratios[key] / currentRatioSum));
                budget[key] += additionalAllocation;
                remainingTokens -= additionalAllocation;
            }
        }
        // Distribute any leftover tokens due to Math.floor rounding to the highest priority section
        if (remainingTokens > 0) {
            budget[priorities[0]] += remainingTokens;
        }
    }

    return budget as TokenBudget;
}

/**
 * Helper to calculate total token budget from context window or fixed limits.
 */
export function calculateBudget(options: {
    totalTokens?: number,
    contextWindow?: number,
    reserveFactor?: number
}): number {
    if (options.totalTokens) return options.totalTokens;
    if (options.contextWindow) return Math.floor(options.contextWindow * (options.reserveFactor || 0.6));
    return 4000; // Default fallback
}

/**
 * Estimates token count from text content.
 * Uses a simple heuristic: ~4 characters per token for English text.
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Truncates text to fit within a token budget.
 * Attempts to truncate at a logical boundary (newline or sentence end).
 */
function truncateToBudget(text: string, maxTokens: number): string {
    if (estimateTokens(text) <= maxTokens) {
        return text;
    }

    const maxChars = maxTokens * 4;
    let truncated = text.slice(0, maxChars);

    // Try to find a good breaking point
    const lastNewline = truncated.lastIndexOf('\n');
    const lastSentence = truncated.lastIndexOf('. ');

    if (lastNewline > maxChars * 0.8) {
        truncated = truncated.slice(0, lastNewline);
    } else if (lastSentence > maxChars * 0.8) {
        truncated = truncated.slice(0, lastSentence + 1);
    }

    return truncated + '\n[... truncated due to token budget]';
}

/**
 * Compresses tool definitions to fit within budget.
 * Removes optional parameter descriptions if needed.
 */
function compressTools(tools: ToolDefinition[], maxTokens: number): string {
    let serialized = serializeTools(tools);

    if (estimateTokens(serialized) <= maxTokens) {
        return serialized;
    }

    // First compression: Remove optional parameters
    const essentialTools = tools.map(tool => {
        const requiredParams = Object.entries(tool.parameters.properties)
            .filter(([name]) => tool.parameters.required?.includes(name))
            .map(([name, schema]) => `  - ${name}: ${schema.description}`)
            .join('\n');
        return `- ${tool.name}: ${tool.description}${requiredParams ? '\n' + requiredParams : ''}`;
    }).join('\n\n');

    if (estimateTokens(essentialTools) <= maxTokens) {
        return essentialTools;
    }

    // Second compression: Only tool names and descriptions
    const minimalTools = tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n');

    return truncateToBudget(minimalTools, maxTokens);
}

/**
 * Compresses selection context to fit within budget.
 * Accepts already serialized NodeLayer array.
 */
function compressSelectionContext(serializedNodes: any[], maxTokens: number): string {
    let serialized = JSON.stringify(serializedNodes, null, 2);

    if (estimateTokens(serialized) <= maxTokens) {
        return serialized;
    }

    // Final fallback: truncate
    return truncateToBudget(serialized, maxTokens);
}

// Agent Core Prompt (Lean & Focused)
const AGENT_CORE_PROMPT = `
You are a Figma design agent. You accomplish tasks by calling tools.

## THINKING PROTOCOL
You have available a native Reasoning/Thinking model.
Briefly plan your approach before executing.

- **Be Concise**: Keep your internal monologue short and focused. Avoid verbose narration.
- **Action Over Perfection**: It is better to create a structure and refine it later than to over-analyze.
- **Iterative Refinement**: You can call tools multiple times. Start with the core structure.

## DECISION FLOW
1. **PLAN**: Briefly outline the hierarchy and layout.
2. **EXECUTE**: Call tools immediately once the next step is clear.
3. **VERIFY**: Check results and refine in subsequent turns.
4. **COMPLETE**: Report success or adjust plan if needed.

## NAMING CONVENTION
- ALWAYS use descriptive, semantic names for layers (e.g., "Primary Button", "Card Title").
- NEVER name a node "unnamed", "layer", or "frame" unless it's a transient state.
- Names should reflect the role or content of the node.

## CONTENT REQUIREMENT
- EVERY TEXT node MUST have meaningful content in the 'characters' field
- NEVER create a TEXT node with empty or default content
- Content should match the node's purpose (e.g., a "Submit Button" should have characters "Submit")

## ERROR RECOVERY
When a tool returns an error:
- \`PARENT_NOT_FOUND\`: Create the parent node first, then retry.
- \`NODE_NOT_FOUND\`: Use only nodeIds returned by createNode. Use \`getSelection\` to find valid IDs.
- \`INVALID_SIZING\`: HUG requires Auto Layout. Add \`layoutMode: "VERTICAL"\` or \`"HORIZONTAL"\` in the same call.

## MISSING INFORMATION
If user request is ambiguous:
- **Missing size**: Use reasonable defaults (e.g., Button: 120x40, Card: 320x200)
- **Missing color**: Use neutral palette (#FFFFFF, #1F1F1F, #666666)
- **Missing text**: Generate contextual placeholder (e.g., "Submit", "Card Title")
`;

// Extended Tool Examples
const TOOL_EXAMPLES = `
## EXAMPLES

### Example 1: Parallel Information Gathering ✅
User: "优化当前选中的元素布局"

**Parallel batch (collect context):**
[getSelection, getVariables, getStyles]

System responses:
{selection: [{id: "123:456", name: "Card", type: "FRAME"}]}
{variables: [...]}
{styles: [...]}

**Sequential execution (apply changes):**
setNodeLayout({nodeId: "123:456", layoutMode: "VERTICAL", padding: {horizontal: 16, vertical: 16}, gap: 12})

---

### Example 2: Create with Dependencies ⚠️
User: "创建一个带标题的卡片"

**Step 1 - Create parent first:**
createNode({type: "FRAME", name: "Card Container"})
→ Returns: {nodeId: "100:1"}

**Step 2 - Create child using parent ID:**
createNode({type: "TEXT", name: "Card Title", parentId: "100:1", characters: "卡片标题"})
→ Returns: {nodeId: "100:2"}

**Step 3 - Configure parent layout:**
setNodeLayout({nodeId: "100:1", layoutMode: "VERTICAL", gap: 12})

⚠️ CRITICAL: Always use nodeId from createNode response. Never guess IDs.

---

### Example 3: Error Recovery
User: "添加 HUG 尺寸"

**Attempt:**
setNodeLayout({nodeId: "100:1", sizing: {horizontal: "HUG"}})
→ Error: {code: "INVALID_SIZING", message: "HUG requires Auto Layout context"}

**Recovery:**
setNodeLayout({nodeId: "100:1", layoutMode: "VERTICAL", sizing: {horizontal: "HUG"}})
→ Success: {success: true}
`;

// ==========================================
// Agent Section Builders
// ==========================================

/**
 * Build Agent Identity section (Priority 1)
 */
function buildAgentIdentity(): string {
    return [
        AGENT_IDENTITY.trim(),
        AGENT_THINKING_PROTOCOL.trim(),
        AGENT_NAMING_CONVENTION.trim(),
        AGENT_CONTENT_REQUIREMENT.trim()
    ].join('\n\n');
}

/**
 * Build Mode-based Guidance section (Priority 1.2)
 */
function buildModeGuidance(mode: AgentMode): string {
    return DYNAMIC_GUIDANCE[mode] || DYNAMIC_GUIDANCE.PLANNING;
}

/**
 * Build Tool Format section (Priority 2)
 */
function buildToolFormat(tools: ToolDefinition[], budget: number): string {
    if (tools.length === 0) {
        return '## AVAILABLE TOOLS\nNo specific tools are available for this session.';
    }
    const toolsHeader = '## AVAILABLE TOOLS\nUse these tools to gather knowledge, validate designs, or perform rendering actions:\n\n';
    
    // Use phase-based serialization if tools have categories
    const hasCategories = tools.some(t => t.category);
    const toolsBody = hasCategories 
        ? serializeToolsByPhase(tools)
        : compressTools(tools, budget);
    
    return toolsHeader + toolsBody;
}

/**
 * Build Tool Examples section (Priority 3)
 */
function buildToolExamples(budget: number): string {
    if (estimateTokens(TOOL_EXAMPLES) <= budget) {
        return TOOL_EXAMPLES;
    }
    return truncateToBudget(TOOL_EXAMPLES, budget);
}

/**
 * Build Decision Flow section (Priority 4)
 * Included in core prompt, no separate builder needed
 */

/**
 * Build Optional Knowledge section (Priority 10, conditional)
 */
function buildOptionalKnowledge(deps: PromptDependencies, budget: number): string {
    if (!deps.intent?.requiresLayoutKnowledge) {
        return '';
    }
    const knowledge = `\n## LAYOUT RULES\n- Use Auto Layout for responsive containers.\n- Set 'hug' for content-dependent sizing.`;
    
    if (estimateTokens(knowledge) <= budget) {
        return knowledge;
    }
    return truncateToBudget(knowledge, budget);
}

/**
 * Build Selection Context section (Priority 5)
 */
function buildSelectionContext(deps: PromptDependencies, budget: number): string {
    if (!deps.selectionContext?.hasSelection || !deps.selectionContext.nodes) {
        return '';
    }
    
    const validNodes = deps.selectionContext.nodes.filter(isValidSceneNode);
    if (validNodes.length === 0) {
        return '';
    }
    
    // First serialize nodes to NodeLayer format
    const serializedNodes = validNodes.map(node =>
        NodeSerializer.serializeWithCompression(node, {
            maxDepth: 2,
            pruneDefaults: true
        })
    );
    
    const selectionHeader = '\n## SELECTION CONTEXT\nThe following nodes are currently selected in Figma. Use this structure to understand the current design state:\n\n```json\n';
    const selectionFooter = '\n```\n';
    
    // Account for header/footer in budget
    const headerFooterTokens = estimateTokens(selectionHeader + selectionFooter);
    const availableForNodes = Math.max(0, budget - headerFooterTokens);
    
    const compressedNodes = compressSelectionContext(serializedNodes, availableForNodes);
    return selectionHeader + compressedNodes + selectionFooter;
}

// ==========================================
// Agent Section Registry
// ==========================================

/**
 * Agent-specific section registry.
 * Separated from Linear pipeline registry for better maintainability.
 */
const AGENT_SECTION_REGISTRY: AgentPromptSection[] = [
    {
        id: 'agent-identity',
        priority: 1,
        budgetKey: 'core',
        builder: (_deps, _tools, _budget) => buildAgentIdentity()
    },
    {
        id: 'mode-guidance',
        priority: 1.2,
        budgetKey: 'core',
        builder: (_deps, _tools, _budget, mode) => buildModeGuidance(mode || 'PLANNING')
    },
    {
        id: 'tool-format',
        priority: 2,
        budgetKey: 'tools',
        builder: (_deps, tools, budget) => buildToolFormat(tools, budget)
    },
    {
        id: 'tool-examples',
        priority: 3,
        budgetKey: 'examples',
        builder: (_deps, _tools, budget) => buildToolExamples(budget)
    },
    {
        id: 'selection-context',
        priority: 5,
        budgetKey: 'selection',
        builder: (deps, _tools, budget) => buildSelectionContext(deps, budget)
    },
    {
        id: 'optional-knowledge',
        priority: 10,
        budgetKey: 'context',
        // Always check deps.intent for knowledge injection
        builder: (deps, _tools, budget) => buildOptionalKnowledge(deps, budget)
    }
];

/**
 * @deprecated Use AGENT_SECTION_REGISTRY instead. Kept for backward compatibility.
 */
function injectKnowledgeIfNeeded(intent?: { requiresLayoutKnowledge?: boolean }): string {
    // Only inject knowledge if explicitly required intent is present
    if (intent?.requiresLayoutKnowledge) {
        // Placeholder for actual layout rules.
        // In a real scenario, this might come from a localized knowledge base or updated based on RAG.
        return `\n## LAYOUT RULES\n- Use Auto Layout for responsive containers.\n- Set 'hug' for content-dependent sizing.`;
    }
    return '';
}

/**
 * Standard system prompt composer for the linear pipeline.
 */
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

/**
 * Lean system prompt composer for the Agentic Loop.
 * Focuses on identity, tool availability, and constraints.
 * 
 * Implements token budget control to ensure prompts stay within LLM context limits.
 * Uses AGENT_SECTION_REGISTRY for modular section management.
 * 
 * Budget allocation (total ~4800 tokens):
 *   - core: 1000 tokens (identity + tool format, non-compressible)
 *   - tools: 800 tokens (tool definitions)
 *   - examples: 1500 tokens (complete examples, high priority)
 *   - context: 1000 tokens (RAG knowledge, compressible)
 *   - selection: 500 tokens (current selection, truncatable)
 */
  export function composeAgentSystemPrompt(
    deps: PromptDependencies,
    tools: ToolDefinition[],
    provider: { getToolSystemInstruction: (tools: ToolDefinition[]) => string },
    options: { totalBudget?: number; ratios?: TokenRatios; mode?: AgentMode } = {},
    flags: AgentFeatureFlags = {}
): string {
    const totalBudget = options.totalBudget || 4000;
    const ratios = options.ratios || DEFAULT_TOKEN_RATIOS;
    const mode = options.mode || 'PLANNING';
    
    const parts: string[] = [];
    const budgetLog: { section: string; allocated: number; used: number; note?: string; nodes?: number }[] = [];

    // Liquid Budgeting: Initialize the running buckets
    const runningBuckets = calculateLiquidBudget(totalBudget, ratios);
    let globalSurplus = 0;

    // Inject Provider-specific tool instructions into a new section
    const providerInstruction = provider.getToolSystemInstruction(tools);
    
    const compositionSections = [
        ...AGENT_SECTION_REGISTRY,
        {
            id: 'provider-instructions',
            priority: 1.5,
            budgetKey: 'core' as const,
            builder: () => providerInstruction
        }
    ];

    const activeSections = compositionSections
        .filter(section => {
            if ('enabled' in section && section.enabled) {
                return section.enabled(flags);
            }
            return true;
        })
        .sort((a, b) => a.priority - b.priority);

    for (const section of activeSections) {
        try {
            // Available for this section: current bucket contents + global surplus
            const currentBucketAmount = runningBuckets[section.budgetKey];
            const allocatedTokens = currentBucketAmount + globalSurplus;
            
            const content = section.builder(deps, tools, allocatedTokens, mode);
            
            if (content) {
                const usedTokens = estimateTokens(content);
                
                // Calculate how much we consumed from the bucket vs surplus
                // 1. Prioritize consuming global surplus
                const consumedFromSurplus = Math.min(usedTokens, globalSurplus);
                globalSurplus -= consumedFromSurplus;

                // 2. Consume remainder from the bucket
                const consumedFromBucket = Math.max(0, usedTokens - consumedFromSurplus);
                const bucketRemainder = currentBucketAmount - consumedFromBucket;

                // 3. Any leftover from the bucket flows into global surplus for the NEXT section
                globalSurplus += Math.max(0, bucketRemainder);
                
                // 4. Update the bucket to reflect consumption
                const key = section.budgetKey as keyof TokenBudget;
                runningBuckets[key] = Math.max(0, bucketRemainder);
                
                parts.push(content);
                budgetLog.push({
                    section: section.id,
                    allocated: allocatedTokens,
                    used: usedTokens,
                    note: usedTokens > allocatedTokens ? 'exceeded' : undefined
                });
            }
        } catch (error) {
            console.error(`[PromptComposer] Error building section ${section.id}:`, error);
        }
    }

    const finalPrompt = parts.join('\n\n');
    const totalTokens = estimateTokens(finalPrompt);
    
    // Log budget usage
    console.log(`[AgentPrompt] Token budget usage:`);
    budgetLog.forEach(entry => {
        const percentage = Math.round((entry.used / entry.allocated) * 100);
        const noteStr = entry.note ? ` [${entry.note}]` : '';
        console.log(`  - ${entry.section}: ${entry.used}/${entry.allocated} tokens (${percentage}%)${noteStr}`);
    });
    console.log(`[AgentPrompt] Total: ${totalTokens}/${totalBudget} tokens (${Math.round((totalTokens / totalBudget) * 100)}% of budget)`);
    
    return finalPrompt;
}

/**
 * Type guard to ensure a node from SelectionContext has the minimum required structure
 * to be treated as a SceneNode by the Serializer.
 */
function isValidSceneNode(node: any): node is SceneNode {
    return (
        node !== null &&
        typeof node === 'object' &&
        typeof node.id === 'string' &&
        typeof node.type === 'string'
    );
}

/**
 * Helper to serialize tool definitions into a readable format for the prompt.
 */
function serializeTools(tools: ToolDefinition[]): string {
    return tools.map(tool => {
        const params = Object.entries(tool.parameters.properties)
            .map(([name, schema]) => `  - ${name} (${schema.type}): ${schema.description}${tool.parameters.required?.includes(name) ? ' [Required]' : ''}`)
            .join('\n');
        return `- ${tool.name}: ${tool.description}\n${params}`;
    }).join('\n\n');
}

/**
 * Phase-based tool serialization with category grouping and dependency hints.
 */
function serializeToolsByPhase(tools: ToolDefinition[]): string {
    const phases = {
        read: tools.filter(t => t.category === 'read'),
        knowledge: tools.filter(t => t.category === 'knowledge'),
        plan: tools.filter(t => t.category === 'plan'),
        create: tools.filter(t => t.category === 'create'),
        modify: tools.filter(t => t.category === 'modify'),
        validate: tools.filter(t => t.category === 'validate')
    };

    const formatTool = (tool: ToolDefinition) => {
        const deps = tool.dependencies && tool.dependencies.length > 0 
            ? ` (after: ${tool.dependencies.join(', ')})` 
            : '';
        return `- **${tool.name}**${deps}: ${tool.description}`;
    };

    const sections = [];
    
    if (phases.read.length > 0 || phases.knowledge.length > 0) {
        sections.push(`### 📖 Phase 1: Information Gathering (Parallel)
${[...phases.read, ...phases.knowledge].map(formatTool).join('\n')}`);
    }
    
    if (phases.plan.length > 0) {
        sections.push(`### 📝 Phase 2: Planning (Sequential)
${phases.plan.map(formatTool).join('\n')}`);
    }
    
    if (phases.create.length > 0 || phases.modify.length > 0) {
        sections.push(`### 🛠 Phase 3: Execution (Sequential, respect dependencies)
${[...phases.create, ...phases.modify].map(formatTool).join('\n')}`);
    }
    
    if (phases.validate.length > 0) {
        sections.push(`### ✅ Phase 4: Validation (Parallel)
${phases.validate.map(formatTool).join('\n')}`);
    }

    return sections.join('\n\n');
}

