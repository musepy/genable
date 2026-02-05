const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const componentsDir = path.join(__dirname, '../src/knowledge/components');
const registryFile = path.join(__dirname, '../src/knowledge/projectUIRegistry.ts');
const semanticRulesFile = path.join(__dirname, '../src/knowledge/semanticRules.yaml');

const components = fs.readdirSync(componentsDir);
const registryEntries = [];

components.forEach(comp => {
  const specPath = path.join(componentsDir, comp, 'spec.yaml');
  if (fs.existsSync(specPath)) {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    registryEntries.push(spec);
  }
});

const semanticRules = yaml.load(fs.readFileSync(semanticRulesFile, 'utf8'));

let registryContent = fs.readFileSync(registryFile, 'utf8');

// Preserve existing imports and interfaces
const headerMatch = registryContent.match(/[\s\S]*?\/\/ === GENERATED ENTRIES START ===/);
const footerMatch = registryContent.match(/\/\/ === GENERATED ENTRIES END ===[\s\S]*/);

if (headerMatch && footerMatch) {
  const newContent = `${headerMatch[0]}\n` +
    `export const PROJECT_UI_REGISTRY: UIComponentRegistry = ${JSON.stringify(registryEntries, null, 2)};\n\n` +
    `export const SEMANTIC_RULES: SemanticRule[] = ${JSON.stringify(semanticRules.rules, null, 2)};\n` +
    `${footerMatch[0]}`;
  
  fs.writeFileSync(registryFile, newContent);
  console.log('✅ UI Registry synchronized');
} else {
  console.error('❌ Could not find generation markers in projectUIRegistry.ts');
}
