/**
 * @file fileSkillLoader.ts
 * @description File-system based skill loader.
 * 
 * Scans directories for SKILL.md files and loads them on-demand.
 * Based on Cline's implementation pattern.
 */

// [FIX] Handle environments without 'fs' (Figma Sandbox)
// We still import them for the types, but we'll use a dynamic approach
let fs: any;
let path: any;
try {
  fs = require('fs');
  path = require('path');
} catch (e) {
  // We're likely in the Figma sandbox
}

import { parseYamlFrontmatter } from './frontmatter';
import {
  SkillDefinition,
  SkillCategory,
  SkillPriority,
  SkillContext
} from './types';
import { ToolDefinition } from '../tools/types';

// Tool registry for name -> definition lookup
import { agentTools } from '../tools';

// Fallback registry for bundled builds
import skillsRegistry from '../../../generated/skills-registry.json';

/**
 * Lightweight skill metadata (loaded at startup).
 * Only contains info needed for skill listing and triggering.
 */
export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  path: string;
  source: 'project' | 'global' | 'bundled'; // Added 'bundled' source type
}

/**
 * Raw frontmatter data from SKILL.md
 */
interface SkillFrontmatter {
  id?: string;
  name?: string;
  description?: string;
  category?: SkillCategory;
  priority?: number;
  tools?: string[];
  enabledByDefault?: boolean;
}

/**
 * Normalize legacy tool names in skill prose to unified tool names.
 * This prevents old prompts from nudging the model toward deprecated calls.
 *
 * NOTE: Knowledge files should use current tool names directly.
 * This is a safety net for any remaining legacy references.
 */
function sanitizeLegacyToolReferences(text: string): string {
  if (!text) return text;
  return text
    // CLI run() wrapper → direct tool calls
    .replace(/run\(\{command:\s*"man\s+/g, 'knowledge({topic: "')
    .replace(/run\(\{command:\s*"grep\s+/g, 'search({query: "')
    .replace(/run\(\{command:\s*"sed\s+/g, 'search({node: "')
    .replace(/run\(\{command:\s*"rm\s+/g, 'structure({action: "delete", node: "')
    .replace(/run\(\{command:\s*"mv\s+/g, 'structure({action: "move", node: "')
    .replace(/run\(\{command:\s*"cp\s+/g, 'structure({action: "clone", node: "')
    // Standalone CLI command names in code blocks/examples
    .replace(/\bmk\s+\//g, 'jsx  /')
    .replace(/\bcat\s+\//g, 'inspect /')
    .replace(/\btree\s+\//g, 'inspect /')
    .replace(/\bls\s+\//g, 'inspect /')
    .replace(/\bman\s+(\w)/g, 'knowledge({topic: "$1')
    // Render is fully removed
    .replace(/\brender\b/gi, 'jsx');
}

/**
 * Get tool definition by name from the registry.
 */
function getToolByName(name: string): ToolDefinition | undefined {
  return agentTools.find(t => t.name === name);
}

/**
 * Scan a directory for skill subdirectories containing SKILL.md files.
 * Only reads frontmatter (lightweight).
 */
export async function scanSkillsDirectory(
  dirPath: string, 
  source: 'project' | 'global'
): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = [];

  // Fallback to static registry if fs is not available
  if (!fs || !fs.readdirSync) {
    console.log('[Skills] Using static registry (bundled build)');
    return Object.values(skillsRegistry).map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      path: `bundled:${s.id}`, // Placeholder path
      source: 'bundled',
    } as SkillMetadata));
  }

  if (!fs.existsSync(dirPath)) {
    return skills;
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return skills;
  }

  try {
    const entries = fs.readdirSync(dirPath);

    for (const entryName of entries) {
      const entryPath = path.join(dirPath, entryName);
      const entryStat = fs.statSync(entryPath);
      
      if (!entryStat.isDirectory()) continue;

      const skillPath = path.join(entryPath, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;

      const content = fs.readFileSync(skillPath, 'utf-8');
      const { data } = parseYamlFrontmatter(content);
      const fm = data as SkillFrontmatter;

      skills.push({
        id: fm.id || entryName,
        name: fm.name || entryName,
        description: fm.description || '',
        path: skillPath,
        source,
      });
    }
  } catch (error) {
    console.warn(`[SkillLoader] Failed to scan ${dirPath}:`, error);
  }

  return skills;
}

/**
 * Load full skill content from a SKILL.md file.
 * Called on-demand when skill is activated.
 */
export function loadSkillContent(skill: SkillMetadata): SkillDefinition | null {
  try {
    let body: string;
    let fm: SkillFrontmatter;

    if (skill.source === 'bundled' && skill.path.startsWith('bundled:')) {
      const registryKey = skill.path.split(':')[1];
      const bundledSkill = (skillsRegistry as any)[registryKey];
      if (!bundledSkill) {
        console.error(`[SkillLoader] Bundled skill ${skill.id} not found in registry.`);
        return null;
      }
      fm = bundledSkill.frontmatter as SkillFrontmatter;
      body = bundledSkill.body;
    } else {
      if (!fs || !fs.readFileSync) {
        console.error(`[SkillLoader] fs module not available to load skill ${skill.id} from path.`);
        return null;
      }
      const content = fs.readFileSync(skill.path, 'utf-8');
      const parsed = parseYamlFrontmatter(content);
      fm = parsed.data as SkillFrontmatter;
      body = parsed.body;
    }

    // Resolve tool references to actual definitions
    const tools: ToolDefinition[] = (fm.tools || [])
      .map(getToolByName)
      .filter((t): t is ToolDefinition => t !== undefined);

    const context: SkillContext = {
      systemPromptSection: sanitizeLegacyToolReferences(body.trim()),
    };

    return {
      id: fm.id || skill.id,
      name: fm.name || skill.name,
      description: fm.description || skill.description,
      category: fm.category || 'core',
      priority: (fm.priority || 5) as SkillPriority,
      tools,
      executors: {}, // Executors handled by IPC bridge
      context,
      enabledByDefault: fm.enabledByDefault ?? true,
    };
  } catch (error) {
    console.error(`[SkillLoader] Failed to load skill ${skill.id}:`, error);
    return null;
  }
}

/**
 * Load all skills from a directory.
 */
export async function loadSkillsFromDirectory(
  dirPath: string,
  source: 'project' | 'global' = 'project'
): Promise<SkillDefinition[]> {
  const metadata = await scanSkillsDirectory(dirPath, source);
  const skills: SkillDefinition[] = [];

  for (const meta of metadata) {
    const skill = loadSkillContent(meta);
    if (skill) {
      skills.push(skill);
      console.log(`[SkillLoader] Loaded skill: ${skill.id} (${source})`);
    }
  }

  return skills;
}

/**
 * Get default skills directory path (project-level).
 */
export function getProjectSkillsDir(projectRoot: string): string {
  if (!path || !path.join) return '';
  return path.join(projectRoot, '.agent', 'skills');
}
