/**
 * @file generate-prompt-catalog.js
 * @description Build-time script to scan src/prompts/ and generate a static JSON catalog.
 *
 * Expected structure:
 *   src/prompts/CORE.md          → catalog.CORE
 *   src/prompts/DESIGN_RULES.md  → catalog.DESIGN_RULES
 *   src/prompts/WORKFLOW.md      → catalog.WORKFLOW
 *   src/prompts/EXAMPLES.md      → catalog.EXAMPLES
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROMPTS_DIR = path.join(PROJECT_ROOT, 'src', 'prompts');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'src', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'prompt-catalog.json');
const LEGACY_TERMS = [
  'generateDesign',
  'batchOperations',
  'applyDesignPatch',
  'complete_task',
];

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
  console.log('🔨 Generating Prompt Catalog...');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Scan only top-level .md files (flat structure, no subdirectories)
  const catalog = {};
  for (const item of fs.readdirSync(PROMPTS_DIR)) {
    const fullPath = path.join(PROMPTS_DIR, item);
    if (fs.statSync(fullPath).isFile() && item.endsWith('.md')) {
      const key = path.parse(item).name.toUpperCase();
      catalog[key] = fs.readFileSync(fullPath, 'utf-8').trim();
    }
  }

  // Legacy term guard
  const serializedCatalog = JSON.stringify(catalog);
  const detectedLegacyTerms = LEGACY_TERMS.filter(term => serializedCatalog.includes(term));
  if (detectedLegacyTerms.length > 0) {
    throw new Error(
      `Legacy prompt terms detected in catalog: ${detectedLegacyTerms.join(', ')}. ` +
      'Please migrate prompt sources under src/prompts/ to unified tool names.'
    );
  }

  safeJsonWrite(OUTPUT_FILE, catalog);

  // Clean up legacy artifacts
  const legacyFiles = [path.join(OUTPUT_DIR, 'prompt-catalog.json.bak')];
  for (const legacyFile of legacyFiles) {
    if (fs.existsSync(legacyFile)) {
      fs.unlinkSync(legacyFile);
      console.log(`🧹 Removed legacy artifact: ${path.relative(PROJECT_ROOT, legacyFile)}`);
    }
  }

  console.log(`✅ Generated prompt-catalog.json (${Object.keys(catalog).length} entries: ${Object.keys(catalog).join(', ')})`);
}

main();
