/**
 * @file SkillRegistry.ts
 * @description Central registry for agent skills.
 *
 * The SkillRegistry manages skill registration, activation, and
 * provides unified access to tools and prompt sections.
 */

import {
  SkillDefinition,
  SkillState,
  ISkillRegistry,
  SkillContextDependencies,
  SkillPromptSection,
} from './types';
import { ToolDefinition, ToolExecutor } from '../tools/types';

/**
 * Singleton skill registry implementation.
 */
class SkillRegistryImpl implements ISkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private states: Map<string, SkillState> = new Map();

  /**
   * Register a skill with the registry.
   */
  register(skill: SkillDefinition): void {
    // Validate skill definition
    if (!skill.id || !skill.name) {
      throw new Error(`Invalid skill definition: missing id or name`);
    }

    // Check for duplicate registration
    if (this.skills.has(skill.id)) {
      console.warn(`[SkillRegistry] Skill "${skill.id}" already registered. Overwriting.`);
    }

    // Register skill
    this.skills.set(skill.id, skill);

    // Initialize state
    this.states.set(skill.id, {
      id: skill.id,
      enabled: skill.enabledByDefault ?? true,
      contextActive: false,
    });

    console.log(`[SkillRegistry] Registered skill: ${skill.id} (${skill.category})`);
  }

  /**
   * Get a skill by ID.
   */
  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  /**
   * Get all registered skills.
   */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get enabled skills, sorted by priority.
   */
  getEnabled(): SkillDefinition[] {
    return Array.from(this.skills.values())
      .filter(skill => this.states.get(skill.id)?.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Enable a skill.
   */
  enable(id: string): void {
    const state = this.states.get(id);
    if (state) {
      state.enabled = true;
      console.log(`[SkillRegistry] Enabled skill: ${id}`);
    }
  }

  /**
   * Disable a skill.
   */
  disable(id: string): void {
    const state = this.states.get(id);
    if (state) {
      state.enabled = false;
      console.log(`[SkillRegistry] Disabled skill: ${id}`);
    }
  }

  /**
   * Get all tools from enabled skills.
   */
  getActiveTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    const seenNames = new Set<string>();

    for (const skill of this.getEnabled()) {
      for (const tool of skill.tools) {
        if (!seenNames.has(tool.name)) {
          tools.push(tool);
          seenNames.add(tool.name);
        }
      }
    }

    return tools;
  }

  /**
   * Get all executors from enabled skills.
   */
  getActiveExecutors(): Record<string, ToolExecutor> {
    const executors: Record<string, ToolExecutor> = {};

    for (const skill of this.getEnabled()) {
      Object.assign(executors, skill.executors);
    }

    return executors;
  }

  /**
   * Build prompt sections from enabled skills.
   */
  buildPromptSections(deps: SkillContextDependencies): SkillPromptSection[] {
    const sections: SkillPromptSection[] = [];

    for (const skill of this.getEnabled()) {
      // Check if skill should be contextually active
      const shouldActivate = this.shouldActivateContext(skill, deps);

      if (shouldActivate) {
        // Mark context as active
        const state = this.states.get(skill.id);
        if (state) {
          state.contextActive = true;
          state.stickyActive = true; // Once activated, make it sticky
        }

        // Add system prompt section if defined
        if (skill.context.systemPromptSection) {
          sections.push({
            skillId: skill.id,
            priority: skill.priority * 10, // Base priority
            content: skill.context.systemPromptSection,
            type: 'guidance',
          });
        }

        // Add dynamic context if builder exists
        if (skill.context.dynamicContextBuilder) {
          const dynamicContent = skill.context.dynamicContextBuilder(deps);
          if (dynamicContent) {
            sections.push({
              skillId: skill.id,
              priority: skill.priority * 10 + 1,
              content: dynamicContent,
              type: 'context',
            });
          }
        }

        // Add usage examples if defined
        if (skill.context.usageExamples && skill.context.usageExamples.length > 0) {
          const examplesContent = this.formatUsageExamples(skill);
          sections.push({
            skillId: skill.id,
            priority: skill.priority * 10 + 2,
            content: examplesContent,
            type: 'examples',
          });
        }
      }
    }

    // Sort by priority
    return sections.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if a skill's context should be activated based on conditions.
   */
  private shouldActivateContext(
    skill: SkillDefinition,
    deps: SkillContextDependencies
  ): boolean {
    const { injectionType, triggerPatterns } = skill.context;

    // Sticky skills are always active once triggered
    const state = this.states.get(skill.id);
    if (state?.stickyActive) {
      return true;
    }

    // System injection is always active
    if (injectionType === 'system') {
      return true;
    }

    // On-demand injection is never automatically active
    if (injectionType === 'on-demand') {
      return false;
    }

    // Dynamic injection checks trigger patterns
    if (injectionType === 'dynamic' && triggerPatterns && deps.userPrompt) {
      const promptLower = deps.userPrompt.toLowerCase();
      return triggerPatterns.some(pattern => {
        const regex = new RegExp(pattern, 'i');
        return regex.test(promptLower);
      });
    }

    // Check activation conditions
    if (skill.activationConditions) {
      for (const condition of skill.activationConditions) {
        if (condition.type === 'always') return true;

        if (condition.type === 'keyword' && condition.value && deps.userPrompt) {
          const regex = new RegExp(condition.value, 'i');
          if (regex.test(deps.userPrompt)) return true;
        }

        // Add more condition types as needed
      }
    }

    return false;
  }

  /**
   * Format usage examples for prompt injection.
   */
  private formatUsageExamples(skill: SkillDefinition): string {
    const examples = skill.context.usageExamples || [];
    if (examples.length === 0) return '';

    const formatted = examples
      .map((ex, i) => {
        const toolCallsStr = ex.toolCalls.join(', ');
        return `Example ${i + 1}: "${ex.userRequest}"
→ Tools: ${toolCallsStr}${ex.explanation ? `\n  Note: ${ex.explanation}` : ''}`;
      })
      .join('\n\n');

    return `### ${skill.name} Examples\n${formatted}`;
  }

  /**
   * Reset all skill states to default.
   */
  reset(): void {
    for (const skill of this.skills.values()) {
      this.states.set(skill.id, {
        id: skill.id,
        enabled: skill.enabledByDefault ?? true,
        contextActive: false,
        stickyActive: false,
      });
    }
    console.log(`[SkillRegistry] Reset all skill states`);
  }

  /**
   * Get skill state.
   */
  getState(id: string): SkillState | undefined {
    return this.states.get(id);
  }
}

/**
 * Singleton instance of the skill registry.
 */
export const skillRegistry = new SkillRegistryImpl();
