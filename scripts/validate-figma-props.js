#!/usr/bin/env node
/**
 * @file validate-figma-props.js
 * @description Validates that properties in figma-api.ts exist in @figma/plugin-typings.
 * 
 * Usage: node scripts/validate-figma-props.js
 */

const fs = require('fs');
const path = require('path');

const TYPINGS_PATH = path.resolve(__dirname, '../node_modules/@figma/plugin-typings/plugin-api.d.ts');
const FIGMA_API_PATH = path.resolve(__dirname, '../src/constants/figma-api.ts');

// Read files
const typingsContent = fs.readFileSync(TYPINGS_PATH, 'utf-8');
const figmaApiContent = fs.readFileSync(FIGMA_API_PATH, 'utf-8');

// Extract all property names from typings (simple regex approach)
const typingsProps = new Set();
// Match property patterns: "propName:" or "readonly propName:" at line start
const propPatterns = [
  /^\s+(?:readonly\s+)?(\w+)\s*:/gm,    // Standard: "  propName:" or "  readonly propName:"
  /^\s+(\w+)\?:/gm                        // Optional: "  propName?:"
];
let match;
for (const pattern of propPatterns) {
  while ((match = pattern.exec(typingsContent)) !== null) {
    typingsProps.add(match[1]);
  }
}

// Extract PROPS values from figma-api.ts
const propsMatch = figmaApiContent.match(/export const PROPS = \{([\s\S]+?)\} as const/);
if (!propsMatch) {
  console.error('Could not find PROPS in figma-api.ts');
  process.exit(1);
}

const ourProps = [];
const propValuePattern = /(\w+):\s*['"](\w+)['"]/g;
while ((match = propValuePattern.exec(propsMatch[1])) !== null) {
  ourProps.push({ key: match[1], value: match[2] });
}

// Compare
console.log('=== Figma Props Validation ===\n');

let hasWarnings = false;
const virtualProps = [
  'iconName', 'semantic', 'variant', 'svgContent',  // Project-specific
  'fontWeight', 'fontFamily', 'textAlign',           // Mapped to fontName.style/family
  'padding', 'gap'                                   // Simplified aliases for paddingLeft/itemSpacing
];

for (const { key, value } of ourProps) {
  if (virtualProps.includes(key)) {
    console.log(`✓ ${key} (virtual property - not in Figma API)`);
  } else if (typingsProps.has(value)) {
    console.log(`✓ ${key}`);
  } else {
    console.log(`⚠ ${key} -> "${value}" NOT FOUND in Figma typings`);
    hasWarnings = true;
  }
}

console.log(`\n--- Summary ---`);
console.log(`Total properties: ${ourProps.length}`);
console.log(`Virtual properties: ${virtualProps.length}`);
console.log(`Status: ${hasWarnings ? 'WARNINGS FOUND' : 'ALL VALID'}`);

process.exit(hasWarnings ? 1 : 0);
