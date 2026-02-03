/**
 * @file generate-skills-registry.js
 * @description Build-time script to scan .agent/ directory and generate a static JSON registry.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = path.join(PROJECT_ROOT, '.agent');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'src', 'generated');

function parseYamlFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: markdown };
  
  const [, yamlContent, body] = match;
  try {
    const data = yaml.load(yamlContent) || {};
    return { data, body };
  } catch (error) {
    return { data: {}, body: markdown, parseError: error.message };
  }
}

function processSkills() {
  const skillsDir = path.join(AGENT_DIR, 'skills');
  const registry = {};

  if (!fs.existsSync(skillsDir)) return registry;

  const categories = fs.readdirSync(skillsDir);
  for (const category of categories) {
    const skillDir = path.join(skillsDir, category);
    if (!fs.statSync(skillDir).isDirectory()) continue;

    const skillPath = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, 'utf-8');
      const { data, body } = parseYamlFrontmatter(content);
      
      registry[category] = {
        id: data.id || category,
        name: data.name || category,
        description: data.description || '',
        frontmatter: data,
        body: body.trim()
      };
    }
  }
  return registry;
}

function processAnatomy() {
  const anatomyDir = path.join(AGENT_DIR, 'knowledge', 'components');
  const registry = {};

  if (!fs.existsSync(anatomyDir)) return registry;

  const files = fs.readdirSync(anatomyDir);
  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

    const filePath = path.join(anatomyDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = yaml.load(content);
    
    const key = path.parse(file).name.replace(/_/g, ' ');
    registry[key.toLowerCase()] = data;
  }
  return registry;
}

function main() {
  console.log('🔨 Generating static Agent registries...');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const skills = processSkills();
  const anatomy = processAnatomy();

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'skills-registry.json'),
    JSON.stringify(skills, null, 2)
  );
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'anatomy-registry.json'),
    JSON.stringify(anatomy, null, 2)
  );

  console.log(`✅ Generated skills-registry.json (${Object.keys(skills).length} skills)`);
  console.log(`✅ Generated anatomy-registry.json (${Object.keys(anatomy).length} items)`);
}

main();
