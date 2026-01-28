import { cssTokens } from './src/ui/design-system/tokens/css';
import { TokenParser } from './src/engine/sync/tokenParser';
import { RADIX_SCALES } from './src/constants/radixColors';

const modes = TokenParser.parse(cssTokens);
const resolved = TokenParser.resolveLinks(modes, true);

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

const themeTokens = resolved[0].tokens.filter(t => 
    !isPrimitiveToken(t.name) && 
    !isRadiusToken(t.name) && 
    !isScalingToken(t.name) &&
    (t.name.startsWith('colors/') || 
     t.name.startsWith('typography/') || 
     t.name.startsWith('font/') || 
     t.name.startsWith('line/') ||
     t.name.startsWith('letter/') ||
     t.name.startsWith('panel/') || 
     t.name.startsWith('tokens/') ||
     t.name.startsWith('space/') ||
     t.name.startsWith('radius/'))
);

console.log('Total identified Theme tokens:', themeTokens.length);
console.log('Sample names:', themeTokens.slice(0, 10).map(t => t.name));
