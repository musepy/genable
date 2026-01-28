import { cssTokens } from './src/ui/design-system/tokens/css';
import { TokenParser } from './src/engine/sync/tokenParser';
import { RADIX_SCALES } from './src/constants/radixColors';

// Mock DesignSystemManager's internal helpers
const primitivePrefixes = Object.keys(RADIX_SCALES);

function isPrimitiveToken(name: string): boolean {
    const prefix = name.split('/')[0];
    return primitivePrefixes.includes(prefix) && /^[a-z]+\/[a-z]?\d+$/.test(name);
}

function isRadiusToken(name: string): boolean {
    return name.startsWith('radius/');
}

function isScalingToken(name: string): boolean {
    return name.startsWith('space/') || name.startsWith('size/') || name.startsWith('gap/');
}

const modes = TokenParser.parse(cssTokens);
const resolved = TokenParser.resolveLinks(modes, true);
const semanticTokens = resolved[0].tokens;

const themeTokens = semanticTokens.filter(t => 
    !isPrimitiveToken(t.name) && 
    !isRadiusToken(t.name) && 
    !isScalingToken(t.name)
);

console.log('Total Tokens in CSS:', semanticTokens.length);
console.log('Total Theme Tokens:', themeTokens.length);

const themePrefixes: any = {};
themeTokens.forEach(t => {
    const p = t.name.split('/')[0];
    themePrefixes[p] = (themePrefixes[p] || 0) + 1;
});
console.log('Theme Prefixes:', JSON.stringify(themePrefixes, null, 2));

const excluded = semanticTokens.filter(t => 
    isPrimitiveToken(t.name) || isRadiusToken(t.name) || isScalingToken(t.name)
);
console.log('Excluded count:', excluded.length);

const radiusExcluded = semanticTokens.filter(isRadiusToken);
const scalingExcluded = semanticTokens.filter(isScalingToken);
const primitiveExcluded = semanticTokens.filter(isPrimitiveToken);

console.log('Radius excluded:', radiusExcluded.length);
console.log('Scaling excluded:', scalingExcluded.length);
console.log('Primitive excluded:', primitiveExcluded.length);

// Find missing categories
if (!themePrefixes['typography']) {
    console.log('WARNING: Typography category is MISSING from Theme tokens.');
    const typoRaw = semanticTokens.filter(t => t.name.includes('typography'));
    console.log('Typography in raw tokens:', typoRaw.length);
    if (typoRaw.length > 0) {
        console.log('Sample raw typo:', typoRaw[0]);
    }
}
