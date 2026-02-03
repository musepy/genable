/**
 * @file knowledgeLoader.ts
 * @description Loader for knowledge components and patterns from the file system.
 */

// [FIX] Handle environments without 'fs' (Figma Sandbox)
let fs: any;
let path: any;
let yaml: any;
try {
  fs = require('fs');
  path = require('path');
  yaml = require('js-yaml');
} catch (e) {}

import { ComponentSchema } from '../../../knowledge/types';

// Fallback registry for bundled builds
import anatomyRegistryBundled from '../../../generated/anatomy-registry.json';

/**
 * Registry for component anatomy schemas loaded from YAML.
 */
export type AnatomyRegistry = Record<string, Partial<ComponentSchema>>;

/**
 * Load all component anatomy YAML files from the specified directory.
 */
export function loadAnatomyFromDirectory(dirPath: string): AnatomyRegistry {
  const registry: AnatomyRegistry = {};

  if (!fs || !fs.readFileSync) {
    // Cast through any to bypass strict tuple/array mismatch in generated JSON
    return (anatomyRegistryBundled as any) as AnatomyRegistry;
  }

  if (!fs.existsSync(dirPath)) {
    console.warn(`[KnowledgeLoader] Directory not found: ${dirPath}`);
    return registry;
  }

  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

      const filePath = path.join(dirPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = yaml.load(content) as Partial<ComponentSchema>;
      
      // Use filename (without extension) as the registry key
      const key = path.parse(file).name.replace(/_/g, ' ');
      registry[key.toLowerCase()] = data;
    }
  } catch (error) {
    console.error('[KnowledgeLoader] Error loading anatomy:', error);
  }

  return registry;
}

/**
 * Get the path to the component anatomy directory.
 */
export function getAnatomyDir(projectRoot: string): string {
  if (!path || !path.join) return '';
  return path.join(projectRoot, '.agent', 'knowledge', 'components');
}
