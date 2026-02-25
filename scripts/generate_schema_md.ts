import * as fs from 'fs';

const schemas = JSON.parse(fs.readFileSync('all_tool_schemas.json', 'utf8'));

let md = '# Agent Tool Schemas Reference\n\n';
md += 'This document contains all 24 tool schemas exported from `src/engine/agent/tools/index.ts`.\n\n';

for (const tool of schemas) {
  md += `## \`${tool.name}\`\n`;
  md += `**Description**: ${tool.description}\n\n`;
  if (tool.modes) md += `**Modes**: \`${tool.modes.join('`, `')}\`\n\n`;
  if (tool.executionStrategy) md += `**Execution Strategy**: \`${tool.executionStrategy}\`\n\n`;
  md += `**Parameters Schema**:\n\`\`\`json\n${JSON.stringify(tool.parameters, null, 2)}\n\`\`\`\n\n`;
  md += `---\n\n`;
}

fs.writeFileSync('/Users/daxiaoxiao/.gemini/antigravity/brain/8691c5b0-1584-458c-a222-4f5430d548cd/schemas-reference.md', md);
console.log('Markdown generated.');
