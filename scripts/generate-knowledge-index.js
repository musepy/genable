/**
 * @file generate-knowledge-index.js
 * @description Build-time script to generate a unified knowledge index from all sources.
 *
 * Scans 5 knowledge sources → generates 2 files:
 *   - knowledge-index.json: lightweight catalog [{id, name, description, category}]
 *   - knowledge-content.json: full content keyed by id {[id]: string}
 *
 * Sources:
 *   1. src/guidelines/.md             -> guideline:*
 *   2. src/prompts/help/.md          -> help:*
 *   3. .agent/skills/[name]/SKILL.md -> skill:*
 *   4. src/style-guides/.md          -> style:*
 *   5. .agent/knowledge/components/  -> anatomy:*
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'src', 'generated');

// ==========================================
// Parsers
// ==========================================

function parseYamlFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: markdown.trim() };
  try {
    const data = yaml.load(match[1]) || {};
    return { data, body: match[2].trim() };
  } catch {
    return { data: {}, body: markdown.trim() };
  }
}

function extractStyleTags(content) {
  const match = content.match(/^tags:\s*(.+)$/m);
  if (!match) return [];
  return match[1].split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
}

function extractStyleDescription(content) {
  // Try to extract the ## Description section's first paragraph
  const match = content.match(/## Description\s*\n+([\s\S]*?)(?:\n##|\n\n\n|$)/);
  if (match) {
    const firstPara = match[1].trim().split('\n\n')[0].trim();
    if (firstPara.length > 10) return firstPara.slice(0, 120);
  }
  return '';
}

// ==========================================
// Source Scanners
// ==========================================

function scanGuidelines() {
  const dir = path.join(PROJECT_ROOT, 'src', 'guidelines');
  const entries = [];
  if (!fs.existsSync(dir)) return entries;

  const DESCRIPTIONS = {
    'card-layout': 'Card grid layouts, spacing, responsive behavior, and visual hierarchy',
    'chart': 'Data visualization: chart types, color encoding, axes, and accessibility',
    'dashboard': 'Dashboard layouts, widget grids, KPI cards, and data-dense interfaces',
    'form': 'Form design: field layout, validation, input groups, and error states',
    'landing-page': 'Landing page sections, hero layouts, CTAs, and conversion patterns',
    'mobile': 'Mobile UI patterns, touch targets, bottom sheets, and responsive sizing',
    'navigation': 'Navigation patterns: sidebars, tab bars, breadcrumbs, and menus',
    'table': 'Data tables: column sizing, sorting, pagination, and row actions',
  };

  for (const item of fs.readdirSync(dir)) {
    if (!item.endsWith('.md')) continue;
    const fullPath = path.join(dir, item);
    if (!fs.statSync(fullPath).isFile()) continue;

    const key = path.parse(item).name;
    const content = fs.readFileSync(fullPath, 'utf-8').trim();

    entries.push({
      id: `guideline:${key}`,
      name: `${key.replace(/-/g, ' ')} design guideline`,
      description: DESCRIPTIONS[key] || `Design guidelines for ${key} UI pattern`,
      category: 'guideline',
      content,
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
    if (!data.id) continue;

    entries.push({
      id: `help:${data.id}`,
      name: data.title || data.id,
      description: data.whenToUse || `Help article: ${data.id}`,
      category: 'help',
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
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
    const skillId = data.id || folder;

    entries.push({
      id: `skill:${skillId}`,
      name: data.name || skillId,
      description: data.description || `Skill: ${skillId}`,
      category: 'skill',
      content: body,
    });
  }
  return entries;
}

function scanStyles() {
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

      const key = path.parse(item).name;
      if (seen.has(key)) continue; // deduplicate (src/style-guides/ wins)
      seen.add(key);

      const content = fs.readFileSync(fullPath, 'utf-8').trim();
      const tags = extractStyleTags(content);
      const desc = extractStyleDescription(content);

      entries.push({
        id: `style:${key}`,
        name: `${key.replace(/-/g, ' ')} style guide`,
        description: desc || `Visual style: ${tags.join(', ')}`,
        category: 'style',
        tags,
        content,
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
    try { data = yaml.load(raw); } catch { continue; }

    const key = path.parse(item).name.replace(/_/g, '-');

    entries.push({
      id: `anatomy:${key}`,
      name: data.name || key,
      description: data.description || `Component anatomy: ${key}`,
      category: 'anatomy',
      content: raw,
    });
  }
  return entries;
}

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

  // Build index (lightweight, for search)
  const index = allEntries.map(e => {
    const entry = {
      id: e.id,
      name: e.name,
      description: e.description,
      category: e.category,
    };
    if (e.keywords?.length) entry.keywords = e.keywords;
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
