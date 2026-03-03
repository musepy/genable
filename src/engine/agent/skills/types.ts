/**
 * @file types.ts
 * @description Type definitions for the Skill-based Agent system.
 *
 * A Skill is a modular capability that can be dynamically enabled/disabled.
 * Each Skill contributes:
 * - Tools: Functions the LLM can call
 * - Context: Instructions/knowledge for the LLM to use the tools effectively
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

  /** Context configuration */
  context: SkillContext;

  /** Whether this skill is enabled by default */
  enabledByDefault?: boolean;

  /** Dependencies on other skills (by skill ID) */
  dependencies?: string[];
}

/**
 * Skill context configuration.
 * Full body is loaded on-demand via query_knowledge(source="skill").
 */
export interface SkillContext {
  /**
   * Full skill body (from SKILL.md).
   * Loaded on-demand by query_knowledge, NOT injected into system prompt.
   */
  systemPromptSection?: string;
}

/**
 * Runtime skill state.
 */
export interface SkillState {
  /** Skill ID */
  id: string;

  /** Whether skill is currently enabled */
  enabled: boolean;
}

/**
 * Skill registry interface.
 */
export interface ISkillRegistry {
  register(skill: SkillDefinition): void;
  get(id: string): SkillDefinition | undefined;
  getAll(): SkillDefinition[];
  getEnabled(): SkillDefinition[];
  enable(id: string): void;
  disable(id: string): void;
  getActiveTools(): ToolDefinition[];
  getActiveExecutors(): Record<string, ToolExecutor>;
}
