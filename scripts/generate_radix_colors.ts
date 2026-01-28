
/**
 * @file generate_radix_colors.ts
 * @description Extracts all Radix color scales from Light.tokens.json and formats them as CSS variables.
 */

import * as fs from 'fs';

const themePath = './radix scale/Color scheme/Light.tokens.json';
const data = JSON.parse(fs.readFileSync(themePath, 'utf8'));

function extractColorScale(name: string, obj: any) {
    let css = '';
    const keys = Object.keys(obj).sort((a, b) => parseInt(a) - parseInt(b));
    
    // Determine prefix (e.g. "Gray" -> "gray")
    // If name ends with " Alpha", it's alpha scale
    const isAlpha = name.endsWith(' Alpha');
    const baseName = name.replace(' Alpha', '').toLowerCase();
    
    keys.forEach(key => {
        const token = obj[key];
        const value = token.$value;
        let finalValue = '';

        if (typeof value === 'object') {
            if (value.hex && value.alpha !== undefined && value.alpha < 1) {
                 // Alpha color
                 if (value.components) {
                     const r = Math.round(value.components[0] * 255);
                     const g = Math.round(value.components[1] * 255);
                     const b = Math.round(value.components[2] * 255);
                     const a = parseFloat(value.alpha.toFixed(3));
                     finalValue = `rgba(${r}, ${g}, ${b}, ${a})`;
                 } else {
                     finalValue = value.hex; 
                 }
            } else {
                finalValue = value.hex;
            }
        } else if (typeof value === 'string') {
            finalValue = value;
        }

        const suffix = isAlpha ? `a${key}` : key;
        css += `    --${baseName}-${suffix}: ${finalValue};\n`;
    });
    return css;
}

let output = `    /* --- Radix Scales (Generated) --- */\n`;

if (data.Colors) {
    // Process known Order or alphabetic?
    // Let's do alphabetic but keep pairs (Gray, Gray Alpha) together
    const families = new Set<string>();
    Object.keys(data.Colors).forEach(k => {
        families.add(k.replace(' Alpha', ''));
    });
    
    const sortedFamilies = Array.from(families).sort();
    
    sortedFamilies.forEach(family => {
        // Exclude Gray as it is provided by Theme A (Neutral)
        if (family === 'Gray' || family === 'Gray Alpha') return;

        output += `    /* ${family} */\n`;
        
        if (data.Colors[family]) {
            output += extractColorScale(family, data.Colors[family]);
        }
        const alphaKey = `${family} Alpha`;
        if (data.Colors[alphaKey]) {
            output += extractColorScale(alphaKey, data.Colors[alphaKey]);
        }
        output += '\n';
    });
}

const outputBlock = output;
fs.writeFileSync('temp_radix_primitives.css', outputBlock);
console.log('Successfully generated temp_radix_primitives.css');
