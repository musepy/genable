/**
 * @file index.ts
 * @description Skills module entry point.
 *
 * File-system based skill loading (Cline-style).
 * Skills are loaded from .agent/skills/ directory.
 */

// [FIX] Handle environments without 'path' (Figma Sandbox)
let path: any;
try {
  path = require('path');
} catch (e) {}
import { skillRegistry } from './SkillRegistry';
import { loadSkillsFromDirectory, getProjectSkillsDir } from './fileSkillLoader';
import { knowledgeHub } from '../../llm-client/knowledge/knowledgeHub';

// Core exports
export * from './types';
export { skillRegistry };
export { loadSkillsFromDirectory, getProjectSkillsDir } from './fileSkillLoader';

/**
 * Initialize skills by loading from file system.
 * Call this during application startup.
 */
export async function initializeSkills(): Promise<void> {
  // Load skills from .agent/skills/ directory
  const root = path ? path.resolve(__dirname, '../../../../..') : '';
  const skillsDir = getProjectSkillsDir(root);
  
  try {
    const skills = await loadSkillsFromDirectory(skillsDir, 'project');
    
    for (const skill of skills) {
      skillRegistry.register(skill);
    }

    // Index skill bodies into knowledgeHub for unified search
    const skillDocs = skills
      .filter(s => s.context.systemPromptSection)
      .map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        body: s.context.systemPromptSection!,
      }));
    knowledgeHub.indexSkills(skillDocs);

    console.log(`[Skills] Initialized ${skills.length} skills from ${skillsDir} (${skillDocs.length} indexed)`);
  } catch (error) {
    console.warn('[Skills] Failed to load skills:', error);
    console.log('[Skills] Running with no skills loaded');
  }
}

/**
 * Get all tools from active skills.
 */
export function getActiveAgentTools() {
  return skillRegistry.getActiveTools();
}

/**
 * Get all executors from active skills.
 */
export function getActiveExecutors() {
  return skillRegistry.getActiveExecutors();
}
