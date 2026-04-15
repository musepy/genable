/**
 * @file generate-knowledge-index.js
 * @description Build-time script to generate a unified knowledge index from all sources.
 *
 * Scans 5 knowledge sources → generates 2 files:
 *   - knowledge-index.json: lightweight catalog [{id, name, description, category}]
 *   - knowledge-content.json: full content keyed by id {[id]: string}
 *
 * Sources:
 *   1. src/guidelines/*.md             -> guideline:*   (frontmatter required)
 *   2. src/prompts/help/*.md           -> help:*        (frontmatter required)
 *   3. .agent/skills/[name]/SKILL.md   -> skill:*       (frontmatter required)
 *   4. src/style-guides/*.md + src/guidelines/style-guides/*.md
 *                                      -> style:*       (frontmatter required)
 *   5. .agent/knowledge/components/    -> anatomy:*     (YAML with name + description required)
 *
 * NOTE: ref:* category retired April 2026. 21 entries (12 ref:stack-*, 9 non-stack) had
 * 0 fetches across 8 E2E runs. Merged charts→guideline:chart, landing→guideline:landing-page,
 * migrated products→guideline:product-type-lookup. Stack entries inapplicable to Figma-native.
 *
 * FAIL FAST: every source file must declare a unified frontmatter (id, name, description,
 * category). The generator throws with file path when required fields are missing — no
 * silent fallbacks, no filename→title case inference, no regex scraping of ## Description.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'src', 'generated');

// ==========================================
// Frontmatter Parser + Validator
// ==========================================

function parseYamlFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: null, body: markdown.trim() };
  try {
    const data = yaml.load(match[1]) || {};
    return { data, body: match[2].trim() };
  } catch (err) {
    throw new Error(`YAML frontmatter parse error in frontmatter block: ${err.message}`);
  }
}

/**
 * Validate a source file's frontmatter. Throws with file path on missing fields.
 * Required: id, name, description, category.
 * Enforced: description must start with "Use when" (case-insensitive).
 */
function assertFrontmatter(filePath, data, expectedCategory) {
  if (!data) {
    throw new Error(`[knowledge-index] Missing frontmatter block in ${filePath} — add --- id/name/description/category --- at top of file`);
  }
  const missing = [];
  if (!data.id) missing.push('id');
  if (!data.name) missing.push('name');
  if (!data.description) missing.push('description');
  if (!data.category) missing.push('category');
  if (missing.length) {
    throw new Error(`[knowledge-index] ${filePath} frontmatter missing required field(s): ${missing.join(', ')}`);
  }
  if (data.category !== expectedCategory) {
    throw new Error(`[knowledge-index] ${filePath} frontmatter category "${data.category}" does not match expected "${expectedCategory}"`);
  }
  if (!/^use when/i.test(String(data.description).trim())) {
    throw new Error(`[knowledge-index] ${filePath} description must start with "Use when ..." — got: "${String(data.description).slice(0, 60)}..."`);
  }
}

// ==========================================
// Source Scanners
// ==========================================

function scanGuidelines() {
  const dir = path.join(PROJECT_ROOT, 'src', 'guidelines');
  const entries = [];
  if (!fs.existsSync(dir)) return entries;

  for (const item of fs.readdirSync(dir)) {
    if (!item.endsWith('.md')) continue;
    const fullPath = path.join(dir, item);
    if (!fs.statSync(fullPath).isFile()) continue;

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const { data, body } = parseYamlFrontmatter(raw);
    assertFrontmatter(fullPath, data, 'guideline');

    entries.push({
      id: data.id,
      name: data.name,
      description: data.description,
      category: 'guideline',
      tags: Array.isArray(data.tags) ? data.tags : undefined,
      content: body,
    });
  }
  return entries;
}

function scanHelp() {
  const dir = path.join(PROJECT_ROOT, 'src', 'prompts', 'help');
  const entries = [];
  if (!fs.existsSync(dir)) return entries;

  for (const item of fs.readdirSync(dir)) {
    if (!item.endsWith('.md')) continue;
    const fullPath = path.join(dir, item);
    if (!fs.statSync(fullPath).isFile()) continue;

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const { data, body } = parseYamlFrontmatter(raw);
    assertFrontmatter(fullPath, data, 'help');

    entries.push({
      id: data.id,
      name: data.name,
      description: data.description,
      category: 'help',
      tags: Array.isArray(data.tags) ? data.tags : undefined,
      content: body,
    });
  }
  return entries;
}

function scanSkills() {
  const dir = path.join(PROJECT_ROOT, '.agent', 'skills');
  const entries = [];
  if (!fs.existsSync(dir)) return entries;

  for (const folder of fs.readdirSync(dir)) {
    if (folder.startsWith('_')) continue; // skip _archive
    const skillPath = path.join(dir, folder, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const raw = fs.readFileSync(skillPath, 'utf-8');
    const { data, body } = parseYamlFrontmatter(raw);
    // Skills use their own id (not prefixed). Normalize to skill:<id>.
    if (!data) {
      throw new Error(`[knowledge-index] Missing frontmatter block in ${skillPath}`);
    }
    const missing = [];
    if (!data.id) missing.push('id');
    if (!data.name) missing.push('name');
    if (!data.description) missing.push('description');
    if (missing.length) {
      throw new Error(`[knowledge-index] ${skillPath} frontmatter missing required field(s): ${missing.join(', ')}`);
    }
    if (!/^use when/i.test(String(data.description).trim())) {
      throw new Error(`[knowledge-index] ${skillPath} description must start with "Use when ..." — got: "${String(data.description).slice(0, 60)}..."`);
    }

    entries.push({
      id: `skill:${data.id}`,
      name: data.name,
      description: data.description,
      category: 'skill',
      content: body,
    });
  }
  return entries;
}

function scanStyles() {
  // Both dirs scanned; src/style-guides/ wins dedup when both declare the same id.
  const dirs = [
    path.join(PROJECT_ROOT, 'src', 'style-guides'),
    path.join(PROJECT_ROOT, 'src', 'guidelines', 'style-guides'),
  ];
  const entries = [];
  const seen = new Set();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const item of fs.readdirSync(dir)) {
      if (!item.endsWith('.md')) continue;
      const fullPath = path.join(dir, item);
      if (!fs.statSync(fullPath).isFile()) continue;

      const raw = fs.readFileSync(fullPath, 'utf-8');
      const { data, body } = parseYamlFrontmatter(raw);
      assertFrontmatter(fullPath, data, 'style');

      if (seen.has(data.id)) continue; // src/style-guides/ wins (scanned first)
      seen.add(data.id);

      entries.push({
        id: data.id,
        name: data.name,
        description: data.description,
        category: 'style',
        tags: Array.isArray(data.tags) ? data.tags : undefined,
        content: body,
      });
    }
  }
  return entries;
}

function scanAnatomy() {
  const dir = path.join(PROJECT_ROOT, '.agent', 'knowledge', 'components');
  const entries = [];
  if (!fs.existsSync(dir)) return entries;

  for (const item of fs.readdirSync(dir)) {
    if (!item.endsWith('.yaml') && !item.endsWith('.yml')) continue;
    const fullPath = path.join(dir, item);
    const raw = fs.readFileSync(fullPath, 'utf-8');

    let data;
    try { data = yaml.load(raw); } catch (err) {
      throw new Error(`[knowledge-index] ${fullPath} YAML parse error: ${err.message}`);
    }
    if (!data || typeof data !== 'object') {
      throw new Error(`[knowledge-index] ${fullPath} is empty or not a YAML mapping`);
    }
    if (!data.name) {
      throw new Error(`[knowledge-index] ${fullPath} missing "name" field`);
    }
    if (!data.description) {
      throw new Error(`[knowledge-index] ${fullPath} missing "description" field`);
    }
    if (!/^use when/i.test(String(data.description).trim())) {
      throw new Error(`[knowledge-index] ${fullPath} description must start with "Use when ..." — got: "${String(data.description).slice(0, 60)}..."`);
    }

    const key = path.parse(item).name.replace(/_/g, '-');

    entries.push({
      id: `anatomy:${key}`,
      name: data.name,
      description: data.description,
      category: 'anatomy',
      content: raw,
    });
  }
  return entries;
}

// NOTE: scanUIProMax() removed April 2026 — ref:* category retired.
// 21 entries had 0 fetches across 8 E2E runs. Content merged/migrated into guidelines:
//   ref:charts    → guideline:chart (## Chart Type Selection section)
//   ref:landing   → guideline:landing-page (## Section Patterns section)
//   ref:products  → guideline:product-type-lookup (new file)
//   ref:stack-*   → deleted (framework-specific, inapplicable to Figma-native plugin)
//   ref:colors, ref:typography, ref:styles, ref:reasoning,
//   ref:ux-guidelines, ref:web-interface → deleted (duplicates or web/CSS-only)

// ==========================================
// Figma Sandbox Safe Writer
// ==========================================

function safeJsonWrite(filePath, data) {
  const content = JSON.stringify(data, null, 2);
  const safeContent = content
    .replace(/import\s*\(/g, 'imp_ort(')
    .replace(/import\.\s*meta/g, 'imp_ort.meta')
    .replace(/eval\s*\(/g, 'ev_al(')
    .replace(/new\s*Function\s*\(/g, 'new Fun_ction(');
  fs.writeFileSync(filePath, safeContent);
}

// ==========================================
// Main
// ==========================================

function main() {
  console.log('🔨 Generating unified knowledge index...\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const allEntries = [
    ...scanGuidelines(),
    ...scanHelp(),
    ...scanSkills(),
    ...scanStyles(),
    ...scanAnatomy(),
  ];

  // Duplicate id detection — fail fast if ids collide across sources
  const idSeen = new Map();
  for (const e of allEntries) {
    if (idSeen.has(e.id)) {
      throw new Error(`[knowledge-index] duplicate id "${e.id}" detected in ${e.category} — ids must be globally unique`);
    }
    idSeen.set(e.id, e.category);
  }

  // Build index (lightweight, for search)
  const index = allEntries.map(e => {
    const entry = {
      id: e.id,
      name: e.name,
      description: e.description,
      category: e.category,
    };
    if (e.tags?.length) entry.tags = e.tags;
    return entry;
  });

  // Build content map (full text, for read)
  const content = {};
  for (const e of allEntries) {
    content[e.id] = e.content;
  }

  safeJsonWrite(path.join(OUTPUT_DIR, 'knowledge-index.json'), index);
  safeJsonWrite(path.join(OUTPUT_DIR, 'knowledge-content.json'), content);

  // Summary
  const byCat = {};
  for (const e of index) {
    byCat[e.category] = (byCat[e.category] || 0) + 1;
  }
  console.log(`✅ Generated knowledge-index.json (${index.length} entries)`);
  console.log(`✅ Generated knowledge-content.json`);
  for (const [cat, count] of Object.entries(byCat)) {
    console.log(`   ${cat}: ${count}`);
  }
}

main();
