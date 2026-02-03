/**
 * @file frontmatter.ts
 * @description Parse YAML frontmatter from markdown files.
 * 
 * Based on Cline's implementation - fail-open design.
 * If YAML parsing fails, returns empty data and original markdown body.
 */

import * as yaml from 'js-yaml';

export interface FrontmatterParseResult {
  /** Parsed YAML data as key-value object */
  data: Record<string, unknown>;
  /** Markdown content after stripping frontmatter block */
  body: string;
  /** True when input contained a frontmatter block */
  hadFrontmatter: boolean;
  /** Present only when YAML was detected but failed to parse */
  parseError?: string;
}

/**
 * Parse YAML frontmatter from markdown content.
 * 
 * Behavior is intentionally fail-open:
 * - If YAML fails to parse, returns data={} and body=original markdown
 * - If no frontmatter exists, returns data={} and body=original markdown
 */
export function parseYamlFrontmatter(markdown: string): FrontmatterParseResult {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = markdown.match(frontmatterRegex);

  if (!match) {
    return { data: {}, body: markdown, hadFrontmatter: false };
  }

  const [, yamlContent, body] = match;
  try {
    const data = (yaml.load(yamlContent) as Record<string, unknown>) || {};
    return { data, body, hadFrontmatter: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Skill] YAML frontmatter parse error:', message);
    return { data: {}, body: markdown, hadFrontmatter: true, parseError: message };
  }
}
