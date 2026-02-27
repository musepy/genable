import { PromptDependencies } from '../../../types/context';
import { PROMPT_SECTION_REGISTRY } from './sectionRegistry';
import { configManager } from '../../../config/configManager';
import { ToolDefinition } from '../../agent/tools/types';
import { AgentMode } from '../../../shared/protocol/agentRuntimeEvents';
import { NodeSerializer } from '../../figma-adapter/nodeSerializer';
import {
    AGENT_IDENTITY,
    AGENT_THINKING_PROTOCOL,
    DYNAMIC_GUIDANCE,
    AGENT_NAMING_CONVENTION,
    AGENT_CONTENT_REQUIREMENT,
    AGENT_PARENT_CHILD_RULE,
    AGENT_DESIGN_FREEDOM,
    JSON_FORMAT_RULES
} from '../../agent/agentPrompts';
// Direct imports from centralized prompt registry
import { SCHEMA_RULES, SCENE_GRAPH_MODEL, DESIGN_AESTHETICS } from '../../prompt/promptRegistry';
import { estimateTokens } from '../../agent/context/tokenEstimator';
import { skillRegistry } from '../../agent/skills/SkillRegistry';

// ==========================================
// Agent Mode Section Registry
// ==========================================



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
    skills: number;    // Skill 系统知识 (专用预算，防挤压)
    context: number;   // RAG / optional knowledge (可压缩)
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
    skills: number;
    context: number;
    selection: number;
}

const DEFAULT_TOKEN_RATIOS: TokenRatios = {
    core: 0.20,     // 20% for identity & instructions
    tools: 0.15,    // 15% for tool definitions
    examples: 0.15, // 15% for examples (reduced from 20%)
    skills: 0.15,   // 15% for skill system knowledge (dedicated bucket)
    context: 0.15,  // 15% for optional/RAG knowledge (reduced from 25%)
    selection: 0.20  // 20% for current selection
};

/**
 * Default token budget configuration (reference only).
 * Actual budgets are computed dynamically via calculateLiquidBudget() using DEFAULT_TOKEN_RATIOS.
 * Total: 8000 tokens (matching calculateBudget fallback)
 */
const DEFAULT_TOKEN_BUDGET: TokenBudget = {
    core: 1600,      // 20% - identity + tool format (non-compressible)
    tools: 1200,     // 15% - tool definitions
    examples: 1200,  // 15% - examples
    skills: 1200,    // 15% - skill system knowledge (dedicated)
    context: 1200,   // 15% - optional/RAG knowledge (compressible)
    selection: 1600, // 20% - current selection (truncatable)
};

const SECTION_PRIORITY: (keyof TokenBudget)[] = ['core', 'tools', 'examples', 'skills', 'context', 'selection'];

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
        skills: 0,
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
        skills: 0,
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
    return 8000; // Default fallback (increased from 4000)
}


/**
 * Truncates text to fit within a token budget.
 * Attempts to truncate at a logical boundary (newline or sentence end).
 */
function truncateToBudget(text: string, maxTokens: number): string {
    if (estimateTokens(text) <= maxTokens) {
        return text;
    }

    // Binary search for the optimal truncation point that fits within budget.
    // This handles mixed Chinese/English content correctly.
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        if (estimateTokens(text.slice(0, mid)) <= maxTokens) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    let truncated = text.slice(0, lo);

    // Try to find a good breaking point near the end
    const minBoundary = Math.floor(lo * 0.8);
    const lastNewline = truncated.lastIndexOf('\n', lo);
    const lastSentence = truncated.lastIndexOf('. ', lo);

    if (lastNewline > minBoundary) {
        truncated = truncated.slice(0, lastNewline);
    } else if (lastSentence > minBoundary) {
        truncated = truncated.slice(0, lastSentence + 1);
    }

    return truncated + '\n[... truncated due to token budget]';
}

function compressTools(tools: ToolDefinition[], maxTokens: number): string {
    const serialized = serializeTools(tools);
    return truncateToBudget(serialized, maxTokens);
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

// Tool examples imported from centralized registry
import { TOOL_EXAMPLES } from '../../prompt/promptRegistry';

// ==========================================
// Agent Section Builders
// ==========================================

/**
 * Build Universal Core Identity section (Priority 1)
 * Contains identity, design freedom, and fundamentals needed in ALL modes.
 */
function buildUniversalCoreIdentity(): string {
    return [
        AGENT_IDENTITY.trim(),
        AGENT_DESIGN_FREEDOM.trim(),
        AGENT_THINKING_PROTOCOL.trim()
    ].join('\n\n');
}

/**
 * Build Execution Protocol section (Priority 1.2)
 * Contains strict JSON schema and naming rules needed ONLY during execution.
 */
function buildExecutionProtocol(): string {
    return [
        SCHEMA_RULES.trim(),
        AGENT_PARENT_CHILD_RULE.trim(),
        AGENT_NAMING_CONVENTION.trim(),
        AGENT_CONTENT_REQUIREMENT.trim()
    ].join('\n\n');
}

/**
 * Build Mode-based Guidance section (Priority 1.2)
 */
function buildModeGuidance(mode: AgentMode): string {
    return (DYNAMIC_GUIDANCE as Record<string, string>)[mode] || DYNAMIC_GUIDANCE.EXECUTION || '';
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
    
    // Simply extract the skeleton to prevent context bloat.
    // The Agent should proactively use inspectDesign to query details if needed.
    const serializedNodes = validNodes.map(node => ({
        id: node.id,
        name: node.name,
        type: node.type
    }));
    
    const selectionHeader = '\n## SELECTION CONTEXT\nThe following nodes are currently selected. If you need detailed visual properties or children, proactively call `inspectDesign(nodeId)`.\n\n```json\n';
    const selectionFooter = '\n```\n';
    
    // Account for header/footer in budget
    const headerFooterTokens = estimateTokens(selectionHeader + selectionFooter);
    const availableForNodes = Math.max(0, budget - headerFooterTokens);
    
    const compressedNodes = compressSelectionContext(serializedNodes, availableForNodes);
    return selectionHeader + compressedNodes + selectionFooter;
}

/**
 * Build Iteration State Summary section (Priority 0.1 - Top of prompt)
 */
function buildIterationStateSummary(deps: PromptDependencies): string {
    const activeStep = deps.activeStep;
    const log = deps.operationLog || [];

    if (!activeStep && !deps.planSummary && log.length === 0) return '';

    const lines = ['## CURRENT ITERATION STATE'];

    if (activeStep) {
        lines.push(`- **Active Task**: "${activeStep.title}"`);
        if (activeStep.action) {
            lines.push(`- **Action**: ${activeStep.action}`);
        }
        if (activeStep.nodes && activeStep.nodes.length > 0) {
            lines.push(`- **Target Nodes**: ${activeStep.nodes.join(', ')}`);
        }
        if (activeStep.reasoning) {
            lines.push(`- **Reasoning**: ${activeStep.reasoning}`);
        }
    } else if (deps.planSummary) {
        // VERIFICATION mode: activeStep is null but plan summary is available
        lines.push(`- **Plan Summary**: ${deps.planSummary}`);
    }

    if (log.length > 0) {
        const last3 = log.slice(-3).reverse();
        const opSummaries = last3.map(op => {
            const status = op.success ? '✅' : '❌';
            const id = op.opId ? ` (${op.opId})` : '';
            const reason = op.reason ? ` - *${op.reason}*` : '';
            const error = op.error ? ` [Error: ${op.error}]` : '';
            const corrections = op.diffInfo && op.diffInfo.length > 0 
                ? `\n    ⚠️ [System Correction]: ${op.diffInfo.join('; ')}` 
                : '';
            return `  ${status} ${op.action}${id}${reason}${error}${corrections}`;
        });
        lines.push(`- **Recent History** (last 3 ops):\n${opSummaries.join('\n')}`);
    }

    return lines.join('\n');
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
        builder: (_deps, _tools, _budget) => buildUniversalCoreIdentity()
    },
    {
        id: 'tool-examples',
        priority: 1.1,
        budgetKey: 'examples',
        builder: (_deps, _tools, budget) => buildToolExamples(budget)
    },
    {
        id: 'execution-protocol',
        priority: 1.2,
        budgetKey: 'core',
        builder: (_deps, _tools, _budget, mode) => {
            // Only inject schema and naming rules in EXECUTION or RECOVERY modes
            if (mode !== 'EXECUTION' && mode !== 'RECOVERY') return '';
            return buildExecutionProtocol();
        }
    },
    {
        // Inline critical design knowledge directly (replaces broken lazy-loading KNOWLEDGE_INDEX).
        // SCENE_GRAPH_MODEL: tree structure, layout constraints, sizing rules (~778 tokens)
        // DESIGN_AESTHETICS: shadows, colors, typography, spacing (~355 tokens)
        id: 'design-knowledge-core',
        priority: 1.3,
        budgetKey: 'core',
        builder: (deps, _tools, _budget, mode) => {
            // Skip in VERIFICATION/RECOVERY to save tokens
            if (mode === 'VERIFICATION' || mode === 'RECOVERY') return '';
            const parts: string[] = [SCENE_GRAPH_MODEL.trim()];
            if (mode === 'EXECUTION') {
                // Aesthetics only needed during actual design generation
                if (!deps.behaviorConfig || deps.behaviorConfig.enableAestheticsGuidance !== false) {
                    parts.push(DESIGN_AESTHETICS.trim());
                }
            }
            return parts.join('\n\n');
        }
    },
    {
        // Pin the user's original request in the system prompt so it survives context compression.
        id: 'instruction-anchor',
        priority: 1.8,
        budgetKey: 'core',
        builder: (deps, _tools, _budget) => {
            const originalRequest = deps.intent?.originalRequest;
            if (!originalRequest) return '';
            // Truncate to ~200 tokens to prevent budget bloat
            const truncated = originalRequest.length > 800
                ? originalRequest.slice(0, 800) + '...'
                : originalRequest;
            return `## USER REQUEST (ANCHORED)\n${truncated}\nYou MUST satisfy this request. Every tool call should advance toward fulfilling it.`;
        }
    },
    {
        id: 'mode-guidance',
        priority: 2,
        budgetKey: 'core',
        builder: (_deps, _tools, _budget, mode) => buildModeGuidance(mode || 'PLANNING')
    },
    {
        id: 'tool-format',
        priority: 2.1,
        budgetKey: 'tools',
        builder: (_deps, tools, budget) => buildToolFormat(tools, budget)
    },
    {
        id: 'skill-context',
        priority: 3,
        budgetKey: 'skills',
        builder: (deps) => {
            const skillSections = skillRegistry.buildPromptSections({
                userPrompt: deps.intent?.originalRequest,
                selection: deps.selectionContext ? [deps.selectionContext] : undefined,
                designSystemId: deps.designSystemContext?.skillName,
            });
            if (skillSections.length === 0) return '';
            return skillSections.map(s => s.content).filter(Boolean).join('\n\n');
        }
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
    const totalBudget = options.totalBudget || 8000;
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
            priority: 2.2,
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
                
                // Calculate surplus/deficit relative to the bucket
                const bucketRemainder = currentBucketAmount - usedTokens;
                
                if (bucketRemainder >= 0) {
                    // Used less than the bucket: bucket is "consumed", leftover goes to surplus
                    globalSurplus += bucketRemainder;
                } else {
                    // Used more than the bucket: consume from existing surplus
                    const deficit = Math.abs(bucketRemainder);
                    globalSurplus = Math.max(0, globalSurplus - deficit);
                }

                // Once a section with a specific key is processed, its "initial" allocation
                // is moved into the globalSurplus pool for subsequent sections.
                runningBuckets[section.budgetKey] = 0;
                
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
 * Composes dynamic context information that changes every iteration.
 * This should be injected as a USER message to keep the SYSTEM prompt static for Prefix Caching.
 */
export function composeAgentDynamicContext(
    deps: PromptDependencies,
    options: { selectionBudget?: number } = {}
): string {
    const parts: string[] = [];
    
    // 1. Iteration State (History, Active Task)
    const iterationState = buildIterationStateSummary(deps);
    if (iterationState) parts.push(iterationState);
    
    // 2. Selection Context (Selected nodes)
    const selection = buildSelectionContext(deps, options.selectionBudget || 2000);
    if (selection) parts.push(selection);
    
    return parts.join('\n\n');
}

/**
 * Type guard to ensure a node from SelectionContext has the minimum required structure
 * to be treated as a SceneNode by the Serializer.
 */
function isValidSceneNode(node: any): node is any {
    return (
        node !== null &&
        typeof node === 'object' &&
        typeof node.id === 'string' &&
        typeof node.type === 'string'
    );
}

/**
 * Helper to serialize tool definitions into a compact format for the prompt.
 * Parameters are omitted here because they are already provided to the model 
 * via the Function Calling JSON Schema (function_declarations).
 */
function serializeTools(tools: ToolDefinition[]): string {
    return tools.map(tool => `- **${tool.name}**: ${tool.description}`).join('\n');
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
⚠️ Parent-child createNode calls MUST be sequential. Wait for parent nodeId before creating children.
${[...phases.create, ...phases.modify].map(formatTool).join('\n')}`);
    }
    
    if (phases.validate.length > 0) {
        sections.push(`### ✅ Phase 4: Validation (Parallel)
${phases.validate.map(formatTool).join('\n')}`);
    }

    return sections.join('\n\n');
}

