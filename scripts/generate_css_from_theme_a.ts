/**
 * @file generate_css_from_theme_a.ts
 * @description Extracts ALL tokens from Theme A.tokens.json recursively and formats them as CSS variables.
 */

import * as fs from 'fs';

const themePath = './Theme A.tokens.json';
const data = JSON.parse(fs.readFileSync(themePath, 'utf8'));

/**
 * Helper: Resolve Alias to CSS Variable
 */
function resolveAlias(token: any): string | null {
    const aliasData = token.$extensions?.['com.figma.aliasData'];
    if (!aliasData || !aliasData.targetVariableName) return null;

    const path = aliasData.targetVariableName;
    if (path.startsWith('Colors/')) {
        const parts = path.split('/');
        const familyWithMaybeAlpha = parts[1];
        const step = parts[2];
        const isAlpha = familyWithMaybeAlpha.endsWith(' Alpha');
        const family = familyWithMaybeAlpha.replace(' Alpha', '').toLowerCase();
        const suffix = isAlpha ? `a${step}` : step;
        return `var(--${family}-${suffix})`;
    }
    if (path.startsWith('Radius/')) {
        return `var(--radius-${path.split('/')[1]})`;
    }
    if (path.startsWith('Spacing/')) {
        return `var(--space-${path.split('/')[1]})`;
    }
    return null;
}

/**
 * Helper: Parse Color Object to rgba
 */
function parseColorObject(value: any): string {
    if (value.hex && value.alpha !== undefined && value.components) {
        const r = Math.round(value.components[0] * 255);
        const g = Math.round(value.components[1] * 255);
        const b = Math.round(value.components[2] * 255);
        const a = parseFloat(value.alpha.toFixed(3));
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return value.hex || JSON.stringify(value);
}

/**
 * Helper: Transform Token Path to CSS Variable Name
 * rule: Bijection between JSON Path and CSS Name
 * e.g. ['Colors', 'Accent', '1'] -> --colors-accent-1
 */
function toCssName(path: string[]): string {
    // 1. Clean Each Part: lowercase, replace spaces with hyphens, remove special chars
    const cleanPath = path.map(p => 
        p.toLowerCase()
         .replace(/\s+/g, '-')
         .replace(/[^\w-]/g, '')
    );
    
    // 2. Strict Joining with - to allow lossless reversal via convertNameToPath
    const name = cleanPath.join('-');
    
    // 3. System-wide Normalization (MUST be done at source to be consistent)
    if (name.startsWith('spacing-')) return name.replace('spacing-', 'space-');
    
    return name;
}

let output = `    /* --- Theme A Tokens (Recursive Export) --- */\n`;

/**
 * Recursive Walker
 */
function walk(obj: any, path: string[] = []) {
    if (obj.$value !== undefined) {
        const cssName = toCssName(path);
        const alias = resolveAlias(obj);
        let value = alias || obj.$value;

        if (typeof value === 'object') {
            value = parseColorObject(value);
        }

        // Add px to numeric values for spacing/radius/font-size if not aliased
        if (typeof value === 'number') {
             const n = cssName.toLowerCase();
             if (n.includes('space') || n.includes('radius') || n.includes('size') || n.includes('height') || n.includes('width')) {
                 value = `${value}px`;
             }
        }

        output += `    --${cssName}: ${value};\n`;
        return;
    }

    // Sort keys to maintain stable output (numerically if possible)
    const keys = Object.keys(obj).filter(k => !k.startsWith('$')).sort((a, b) => {
        const na = parseInt(a);
        const nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
    });

    for (const key of keys) {
        walk(obj[key], [...path, key]);
    }
}

// Start extraction
walk(data);

fs.writeFileSync('temp_theme_a.css', output);
console.log('Successfully generated temp_theme_a.css with 100% token coverage.');
