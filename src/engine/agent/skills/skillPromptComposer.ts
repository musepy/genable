/**
 * @file skillPromptComposer.ts
 * @description Skill-aware prompt composer for the agent system.
 *
 * This composer builds system prompts dynamically based on:
 * - Active skills and their context
 * - User intent and conversation context
 * - Token budget constraints
 */

import { skillRegistry } from './SkillRegistry';
import { SkillContextDependencies, SkillPromptSection } from './types';
import { ToolDefinition, AgentMode } from '../tools/types';
import { IDENTITY as BASE_IDENTITY, ERROR_RECOVERY } from '../../prompt/promptRegistry';
import { estimateTokens } from '../context/tokenEstimator';

/**
 * Token budget configuration.
 */
interface TokenBudget {
  total: number;
  identity: number;
  skills: number;
  tools: number;
  context: number;
}

const DEFAULT_BUDGET: TokenBudget = {
  total: 8000,
  identity: 800,
  skills: 3000,
  tools: 3000,
  context: 1200,
};


/**
 * Truncate text to fit within token budget.
 */
function truncateToBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;

  const maxChars = maxTokens * 4;
  let truncated = text.slice(0, maxChars);

  const lastNewline = truncated.lastIndexOf('\n');
  if (lastNewline > maxChars * 0.8) {
    truncated = truncated.slice(0, lastNewline);
  }

  return truncated + '\n[... truncated]';
}

/**
 * Format tools for prompt.
 */
function formatTools(tools: ToolDefinition[]): string {
  // Group tools by category
  const grouped: Record<string, ToolDefinition[]> = {};

  for (const tool of tools) {
    const category = tool.category || 'other';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(tool);
  }

  const sections: string[] = [];

  const categoryLabels: Record<string, string> = {
    read: '📖 Information Gathering',
    knowledge: '📚 Knowledge & Context',
    plan: '📝 Planning',
    create: '🛠 Creation',
    modify: '✏️ Modification',
    validate: '✅ Validation',
    other: '🔧 Other',
  };

  for (const [category, categoryTools] of Object.entries(grouped)) {
    const label = categoryLabels[category] || category;
    const toolList = categoryTools
      .map(t => {
        const deps = t.dependencies?.length ? ` (after: ${t.dependencies.join(', ')})` : '';
        return `- **${t.name}**${deps}: ${t.description}`;
      })
      .join('\n');

    sections.push(`### ${label}\n${toolList}`);
  }

  return sections.join('\n\n');
}

/**
 * Compose system prompt using skill-based architecture.
 */
export function composeSkillBasedPrompt(
  deps: SkillContextDependencies,
  provider: { getToolSystemInstruction: (tools: ToolDefinition[]) => string },
  options: { 
    budget?: Partial<TokenBudget>;
    mode?: AgentMode;
  } = {}
): string {
  const budget = { ...DEFAULT_BUDGET, ...options.budget };
  const mode = options.mode || 'PLANNING';
  const parts: string[] = [];
  const budgetLog: { section: string; tokens: number }[] = [];

  // 1. Base Identity
  parts.push(BASE_IDENTITY);
  budgetLog.push({ section: 'identity', tokens: estimateTokens(BASE_IDENTITY) });

  // 1.1 Mode Guidance (Hot-Swapped)
  const modeGuidance: Record<string, string> = {
    PLANNING: `## CURRENT PHASE: PLANNING\nYour goal is to understand the request and break it down into actionable steps. Use planning tools to create or update the task list. DO NOT perform design operations yet.`,
    EXECUTION: `## CURRENT PHASE: EXECUTION\nPerform the design operations as planned. Use atomic tools to modify the design. Follow design aesthetics and quality rules.`,
    RECOVERY: `## CURRENT PHASE: RECOVERY\nYou are in failure-recovery mode. Diagnose first with inspect tools, identify concrete causes, and only then resume execution with a changed strategy.`,
    VERIFICATION: `## CURRENT PHASE: VERIFICATION\nInspect the results of your operations. Verify that the design matches the user request and meets quality standards.`
  };
  const currentGuidance = modeGuidance[mode];
  parts.push(currentGuidance);
  budgetLog.push({ section: 'mode-guidance', tokens: estimateTokens(currentGuidance) });

  // 2. Skill-injected sections
  const skillSections = skillRegistry.buildPromptSections(deps);
  let skillTokens = 0;

  for (const section of skillSections) {
    const sectionTokens = estimateTokens(section.content);

    // Check budget
    if (skillTokens + sectionTokens > budget.skills) {
      console.log(`[SkillPrompt] Skipping section from ${section.skillId} (budget exceeded)`);
      continue;
    }

    parts.push(section.content);
    skillTokens += sectionTokens;
    budgetLog.push({ section: `skill:${section.skillId}:${section.type}`, tokens: sectionTokens });
  }

  // 3. Tool definitions
  const activeTools = skillRegistry.getActiveTools();
  const toolsSection = `## AVAILABLE TOOLS\n${formatTools(activeTools)}`;
  const truncatedTools = truncateToBudget(toolsSection, budget.tools);
  parts.push(truncatedTools);
  budgetLog.push({ section: 'tools', tokens: estimateTokens(truncatedTools) });

  // 4. Provider-specific instructions
  const providerInstructions = provider.getToolSystemInstruction(activeTools);
  if (providerInstructions) {
    parts.push(providerInstructions);
    budgetLog.push({ section: 'provider', tokens: estimateTokens(providerInstructions) });
  }

  // 5. Error recovery (always include)
  parts.push(ERROR_RECOVERY);
  budgetLog.push({ section: 'error-recovery', tokens: estimateTokens(ERROR_RECOVERY) });

  // Compose final prompt
  const finalPrompt = parts.join('\n\n');
  const totalTokens = estimateTokens(finalPrompt);

  // Log budget usage
  console.log(`[SkillPrompt] Token usage breakdown:`);
  budgetLog.forEach(entry => {
    console.log(`  - ${entry.section}: ${entry.tokens} tokens`);
  });
  console.log(`[SkillPrompt] Total: ${totalTokens}/${budget.total} tokens`);

  return finalPrompt;
}

/**
 * Get prompt dependencies from runtime context.
 */
export function buildSkillContextDeps(
  userPrompt: string,
  options: {
    selection?: any[];
    designSystemId?: string;
    history?: any[];
  } = {}
): SkillContextDependencies {
  return {
    userPrompt,
    selection: options.selection,
    designSystemId: options.designSystemId,
    history: options.history,
    skillData: {},
  };
}
