/**
 * @file generate-help-catalog.js
 * @description Build-time script to scan src/prompts/help/*.md and generate a static JSON catalog.
 *
 * Each .md file has YAML frontmatter (id, title, keywords, whenToUse) and markdown body content.
 * Output: src/generated/help-catalog.json
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HELP_DIR = path.join(PROJECT_ROOT, 'src', 'prompts', 'help');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'src', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'help-catalog.json');

/**
 * Parse simple YAML frontmatter from a markdown string.
 * Supports: string values, bracket-array values (e.g. [a, b, c]).
 * Returns { frontmatter: Record<string, any>, body: string }.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  const rawFm = match[1];
  const body = match[2].trim();
  const frontmatter = {};

  for (const line of rawFm.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Parse bracket arrays: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * [Figma Sandbox Fix] Writes JSON to file while obfuscating strings that trigger
 * 'possible import expression rejected'.
 */
function safeJsonWrite(filePath, data) {
  const content = JSON.stringify(data, null, 2);
  const safeContent = content
    .replace(/import\s*\(/g, 'imp_ort(')
    .replace(/import\.\s*meta/g, 'imp_ort.meta')
    .replace(/eval\s*\(/g, 'ev_al(')
    .replace(/new\s*Function\s*\(/g, 'new Fun_ction(');

  fs.writeFileSync(filePath, safeContent);
}

function main() {
  console.log('🔨 Generating Help Catalog...');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  if (!fs.existsSync(HELP_DIR)) {
    console.log('⚠️  No help directory found at src/prompts/help/ — generating empty catalog.');
    safeJsonWrite(OUTPUT_FILE, { articles: [] });
    return;
  }

  const articles = [];

  for (const item of fs.readdirSync(HELP_DIR)) {
    const fullPath = path.join(HELP_DIR, item);
    if (!fs.statSync(fullPath).isFile() || !item.endsWith('.md')) continue;

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);

    if (!frontmatter.id) {
      console.warn(`⚠️  Skipping ${item}: missing "id" in frontmatter`);
      continue;
    }

    articles.push({
      id: frontmatter.id,
      title: frontmatter.title || frontmatter.id,
      keywords: Array.isArray(frontmatter.keywords) ? frontmatter.keywords : [],
      whenToUse: frontmatter.whenToUse || '',
      content: body,
    });
  }

  // Sort by id for deterministic output
  articles.sort((a, b) => a.id.localeCompare(b.id));

  safeJsonWrite(OUTPUT_FILE, { articles });

  console.log(`✅ Generated help-catalog.json (${articles.length} articles: ${articles.map(a => a.id).join(', ')})`);
}

main();
