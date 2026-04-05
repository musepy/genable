/**
 * @file SkillRegistry.ts
 * @description Central registry for agent skills.
 *
 * Skills are listed as a lightweight menu in the system prompt.
 * Full skill bodies are accessible via `man <skill-id>` at runtime.
 */

import {
  SkillDefinition,
  SkillState,
  ISkillRegistry,
} from './types';

class SkillRegistryImpl implements ISkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private states: Map<string, SkillState> = new Map();

  register(skill: SkillDefinition): void {
    if (!skill.id || !skill.name) {
      throw new Error(`Invalid skill definition: missing id or name`);
    }

    if (this.skills.has(skill.id)) {
      console.warn(`[SkillRegistry] Skill "${skill.id}" already registered. Overwriting.`);
    }

    this.skills.set(skill.id, skill);
    this.states.set(skill.id, { id: skill.id, enabled: skill.enabledByDefault ?? true });

    console.log(`[SkillRegistry] Registered skill: ${skill.id} (${skill.category})`);
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  getEnabled(): SkillDefinition[] {
    return Array.from(this.skills.values())
      .filter(skill => this.states.get(skill.id)?.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  enable(id: string): void {
    const state = this.states.get(id);
    if (state) {
      state.enabled = true;
      console.log(`[SkillRegistry] Enabled skill: ${id}`);
    }
  }

  disable(id: string): void {
    const state = this.states.get(id);
    if (state) {
      state.enabled = false;
      console.log(`[SkillRegistry] Disabled skill: ${id}`);
    }
  }

  reset(): void {
    for (const skill of this.skills.values()) {
      this.states.set(skill.id, { id: skill.id, enabled: skill.enabledByDefault ?? true });
    }
    console.log(`[SkillRegistry] Reset all skill states`);
  }

  getState(id: string): SkillState | undefined {
    return this.states.get(id);
  }

  /** Lightweight menu for system prompt index (~20 tokens/skill). */
  getSkillMenu(): Array<{ id: string; description: string }> {
    return this.getEnabled().map(s => ({
      id: s.id,
      description: s.description,
    }));
  }

  /** Get full skill body for runtime retrieval. */
  getSkillBody(skillId: string): string | null {
    const skill = this.skills.get(skillId);
    if (!skill) return null;
    return skill.context.systemPromptSection || null;
  }
}

export const skillRegistry = new SkillRegistryImpl();
