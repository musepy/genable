
/**
 * @file regenerate_radix_constants.ts
 * @description Regenerates src/constants/radixColors.ts using content from radix scale/Color scheme/{Light,Dark}.tokens.json
 */

import * as fs from 'fs';
import * as path from 'path';

const lightPath = './radix scale/Color scheme/Light.tokens.json';
const darkPath = './radix scale/Color scheme/Dark.tokens.json';
const targetPath = 'src/constants/radixColors.ts';

const lightData = JSON.parse(fs.readFileSync(lightPath, 'utf8'));
const darkData = JSON.parse(fs.readFileSync(darkPath, 'utf8'));

// families: Set<string> (e.g., 'gray', 'blue')
const families = new Set<string>();

// Helper to normalized name -> 'Gray' -> 'gray'
function normalize(name: string) {
    return name.replace(' Alpha', '').toLowerCase();
}

if (lightData.Colors) {
    Object.keys(lightData.Colors).forEach(k => {
        families.add(normalize(k));
    });
}

const sortedFamilies = Array.from(families).sort();

let output = `/**
 * @file radixColors.ts
 * @description standard Radix UI 12-step color scales for Light and Dark modes.
 */

export const RADIX_SCALES = {
`;

function extractHexArray(obj: any): string[] {
    const keys = Object.keys(obj).sort((a, b) => parseInt(a) - parseInt(b));
    return keys.map(k => {
        const val = obj[k].$value;
        if (typeof val === 'object' && val.hex) return `'${val.hex}'`;
        if (typeof val === 'string') return `'${val}'`; // fallback
        return `'#000000'`;
    });
}

function extractRgbaArray(obj: any): string[] {
    const keys = Object.keys(obj).sort((a, b) => parseInt(a) - parseInt(b));
    return keys.map(k => {
        const val = obj[k].$value;
        if (typeof val === 'object' && val.hex && val.alpha !== undefined) {
             if (val.components) {
                 const r = Math.round(val.components[0] * 255);
                 const g = Math.round(val.components[1] * 255);
                 const b = Math.round(val.components[2] * 255);
                 const a = parseFloat(val.alpha.toFixed(3));
                 return `'rgba(${r}, ${g}, ${b}, ${a})'`;
             }
             return `'${val.hex}'`; // fallback hex if no components
        }
        return `'rgba(0,0,0,0)'`;
    });
}

sortedFamilies.forEach(family => {
    // Find keys in Light
    // Capitalized key? e.g. "Gray"
    // The keys in JSON are Capitalized. "Gray", "Blue", "Indigo"
    // My normalize() lowercases them for the export key.
    
    // Reverse lookup to find exact Capitalized Key
    const lightKey = Object.keys(lightData.Colors).find(k => normalize(k) === family && !k.includes('Alpha'));
    const lightAlphaKey = Object.keys(lightData.Colors).find(k => normalize(k) === family && k.includes('Alpha'));
    
    const darkKey = Object.keys(darkData.Colors).find(k => normalize(k) === family && !k.includes('Alpha'));
    const darkAlphaKey = Object.keys(darkData.Colors).find(k => normalize(k) === family && k.includes('Alpha'));

    if (!lightKey) return;

    output += `  ${family}: {\n`;
    
    // Light
    if (lightKey && lightData.Colors[lightKey]) {
        const arr = extractHexArray(lightData.Colors[lightKey]);
        output += `    light: [\n      ${arr.join(', ')}\n    ],\n`;
    }
    
    // Dark
    if (darkKey && darkData.Colors[darkKey]) {
        const arr = extractHexArray(darkData.Colors[darkKey]);
        output += `    dark: [\n      ${arr.join(', ')}\n    ],\n`;
    }

    // Alpha Light
    if (lightAlphaKey && lightData.Colors[lightAlphaKey]) {
        const arr = extractRgbaArray(lightData.Colors[lightAlphaKey]);
        // Format nicely (line break every 6 items?)
        const line1 = arr.slice(0, 6).join(', ');
        const line2 = arr.slice(6).join(', ');
        output += `    alphaLight: [\n        ${line1},\n        ${line2}\n    ],\n`;
    }

    // Alpha Dark
    if (darkAlphaKey && darkData.Colors[darkAlphaKey]) {
        const arr = extractRgbaArray(darkData.Colors[darkAlphaKey]);
        const line1 = arr.slice(0, 6).join(', ');
        const line2 = arr.slice(6).join(', ');
        output += `    alphaDark: [\n        ${line1},\n        ${line2}\n    ]\n`;
    }

    output += `  },\n`;
});

output += `};\n`;

fs.writeFileSync(targetPath, output);
console.log(`Regenerated ${targetPath} with ${sortedFamilies.length} scales.`);
