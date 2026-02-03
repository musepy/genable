/**
 * @file types.ts
 * @description Type definitions for the Skill-based Agent system.
 *
 * A Skill is a modular capability that can be dynamically enabled/disabled.
 * Each Skill contributes:
 * - Tools: Functions the LLM can call
 * - Context: Instructions/knowledge for the LLM to use the tools effectively
 * - Identity: Optional modification to agent persona
 */

import { ToolDefinition, ToolExecutor } from '../tools/types';

/**
 * Skill category for grouping and prioritization.
 */
export type SkillCategory =
  | 'core'        // Essential agent capabilities (always enabled)
  | 'figma'       // Figma manipulation (create, modify, delete)
  | 'knowledge'   // Knowledge retrieval (search, lookup)
  | 'context'     // Context injection (project UI, design system)
  | 'workflow'    // Workflow automation (task management)
  | 'validation'; // Design validation

/**
 * Skill priority determines prompt section ordering.
 * Lower numbers = higher priority (appears earlier in prompt).
 */
export type SkillPriority = 1 | 2 | 3 | 4 | 5;

/**
 * Context injection type determines how skill context is added to prompt.
 */
export type ContextInjectionType =
  | 'system'      // Added to system prompt (persistent)
  | 'dynamic'     // Added based on user intent (conditional)
  | 'on-demand';  // Only when LLM explicitly requests via tool

/**
 * Skill definition interface.
 */
export interface SkillDefinition {
  /** Unique identifier for the skill */
  id: string;

  /** Human-readable name */
  name: string;

  /** Brief description */
  description: string;

  /** Skill category for grouping */
  category: SkillCategory;

  /** Priority for prompt ordering (1 = highest) */
  priority: SkillPriority;

  /** Tool definitions provided by this skill */
  tools: ToolDefinition[];

  /** Tool executors (name -> executor mapping) */
  executors: Record<string, ToolExecutor>;

  /** Context injection configuration */
  context: SkillContext;

  /** Whether this skill is enabled by default */
  enabledByDefault?: boolean;

  /** Dependencies on other skills (by skill ID) */
  dependencies?: string[];

  /** Conditions for automatic activation */
  activationConditions?: SkillActivationCondition[];
}

/**
 * Skill context configuration.
 * Defines how the skill injects knowledge into the LLM prompt.
 */
export interface SkillContext {
  /** How context is injected into prompt */
  injectionType: ContextInjectionType;

  /**
   * System prompt section to add when skill is active.
   * Should explain WHEN and HOW to use the skill's tools.
   */
  systemPromptSection?: string;

  /**
   * Dynamic context builder function.
   * Called when generating prompt to inject runtime context.
   */
  dynamicContextBuilder?: (deps: SkillContextDependencies) => string;

  /**
   * Keywords/patterns that trigger this skill's context injection.
   * Used for 'dynamic' injection type.
   */
  triggerPatterns?: string[];

  /**
   * Example usage to include in prompt.
   * Helps LLM understand how to use the skill's tools.
   */
  usageExamples?: SkillUsageExample[];
}

/**
 * Dependencies available to dynamic context builders.
 */
export interface SkillContextDependencies {
  /** User's current prompt/request */
  userPrompt?: string;

  /** Current Figma selection */
  selection?: any[];

  /** Active design system ID */
  designSystemId?: string;

  /** Conversation history */
  history?: any[];

  /** Custom data from other skills */
  skillData?: Record<string, any>;
}

/**
 * Skill usage example for prompt injection.
 */
export interface SkillUsageExample {
  /** User request that would trigger this skill */
  userRequest: string;

  /** Expected tool calls */
  toolCalls: string[];

  /** Brief explanation */
  explanation?: string;
}

/**
 * Condition for automatic skill activation.
 */
export interface SkillActivationCondition {
  /** Type of condition */
  type: 'keyword' | 'intent' | 'context' | 'always';

  /** Condition value (regex pattern for keyword, intent name, etc.) */
  value?: string;

  /** Priority boost when condition matches */
  priorityBoost?: number;
}

/**
 * Runtime skill state.
 */
export interface SkillState {
  /** Skill ID */
  id: string;

  /** Whether skill is currently enabled */
  enabled: boolean;

  /** Whether skill's context is currently active */
  contextActive: boolean;

  /** Custom runtime data */
  data?: Record<string, any>;
}

/**
 * Skill registry interface.
 */
export interface ISkillRegistry {
  /** Register a skill */
  register(skill: SkillDefinition): void;

  /** Get a skill by ID */
  get(id: string): SkillDefinition | undefined;

  /** Get all registered skills */
  getAll(): SkillDefinition[];

  /** Get enabled skills */
  getEnabled(): SkillDefinition[];

  /** Enable a skill */
  enable(id: string): void;

  /** Disable a skill */
  disable(id: string): void;

  /** Get all tools from enabled skills */
  getActiveTools(): ToolDefinition[];

  /** Get all executors from enabled skills */
  getActiveExecutors(): Record<string, ToolExecutor>;

  /** Build prompt sections from enabled skills */
  buildPromptSections(deps: SkillContextDependencies): SkillPromptSection[];
}

/**
 * Skill prompt section for composition.
 */
export interface SkillPromptSection {
  /** Source skill ID */
  skillId: string;

  /** Section priority */
  priority: number;

  /** Section content */
  content: string;

  /** Section type */
  type: 'identity' | 'guidance' | 'tools' | 'examples' | 'context';
}
