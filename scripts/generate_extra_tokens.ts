/**
 * @file generate_extra_tokens.ts
 * @description Converts Radius and Scaling JSON tokens into a TS file for plugin runtime.
 */

import * as fs from 'fs';

function loadTokens(path: string) {
    if (!fs.existsSync(path)) return [];
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    const tokens: any[] = [];
    
    function walk(obj: any, path: string[] = []) {
        if (obj.$value !== undefined) {
            tokens.push({
                name: path.join('/'),
                value: typeof obj.$value === 'object' ? (obj.$value.hex || JSON.stringify(obj.$value)) : String(obj.$value),
                originalValue: String(obj.$value)
            });
            return;
        }
        for (const key in obj) {
            if (key.startsWith('$')) continue;
            walk(obj[key], [...path, key]);
        }
    }
    walk(data);
    return tokens;
}

const radiusTokens = loadTokens('./radix scale/Mode 1.tokens.json');
const scalingTokens = loadTokens('./radix scale/Mode 1.tokens 2.json');

const content = `
/**
 * Generated file - do not edit manually.
 */
import { TokenMode } from '../engine/sync/tokenParser';

export const EXTRA_RADIUS_TOKENS: TokenMode[] = [
    { name: 'Default', tokens: ${JSON.stringify(radiusTokens, null, 4)} }
];

export const EXTRA_SCALING_TOKENS: TokenMode[] = [
    { name: 'Default', tokens: ${JSON.stringify(scalingTokens, null, 4)} }
];
`;

fs.writeFileSync('src/constants/extraTokens.ts', content);
console.log('Successfully generated src/constants/extraTokens.ts');
