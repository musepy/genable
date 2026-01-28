import { cssTokens } from './src/ui/design-system/tokens/css';
import { TokenParser } from './src/engine/sync/tokenParser';

const modes = TokenParser.parse(cssTokens);
const resolved = TokenParser.resolveLinks(modes, true);

const counts: any = {};
resolved[0].tokens.forEach(t => {
    const prefix = t.name.split('/')[0];
    counts[prefix] = (counts[prefix] || 0) + 1;
});

console.log('Total Tokens:', resolved[0].tokens.length);
console.log('Counts per Prefix:', JSON.stringify(counts, null, 2));

// Special check for Typography and other categories
const typography = resolved[0].tokens.filter(t => t.name.includes('typography') || t.name.includes('font') || t.name.includes('line') || t.name.includes('letter'));
console.log('Typography-related tokens found:', typography.length);
if (typography.length > 0) {
    console.log('Sample typography:', typography.slice(0, 5).map(t => t.name));
}

const colorPrefixes = ['colors', 'color', 'accent', 'neutral', 'semantic'];
const nonColor = resolved[0].tokens.filter(t => !colorPrefixes.some(p => t.name.startsWith(p)));
console.log('Non-color related prefixes:', Array.from(new Set(nonColor.map(t => t.name.split('/')[0]))));
