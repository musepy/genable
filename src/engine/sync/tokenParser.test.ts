import { TokenParser } from './tokenParser';
import { describe, it, expect } from 'vitest';

// Basic mock for the types if needed, but here we just test the logic
describe('TokenParser Alias Preservation', () => {
    it('should convert var(--gray-1) to {gray/1}', () => {
        const css = `
            :root {
                --card: var(--gray-1);
                --background: var(--gray-1);
            }
        `;
        const rawModes = TokenParser.parse(css);
        const resolved = TokenParser.resolveLinks(rawModes, true);
        
        const cardToken = resolved[0].tokens.find(t => t.name === 'card');
        expect(cardToken?.value).toBe('{gray/1}');
    });

    it('should convert hierarchical names like border-subtle to border/subtle', () => {
        const css = `
            :root {
                --border-subtle: #eee;
            }
        `;
        const rawModes = TokenParser.parse(css);
        const resolved = TokenParser.resolveLinks(rawModes, true);
        
        const token = resolved[0].tokens.find(t => t.name === 'border/subtle');
        expect(token).toBeDefined();
    });

    it('should handle Radix alpha scales like gray-a1 to gray/a1', () => {
        const css = `
            :root {
                --overlay: var(--gray-a1);
            }
        `;
        const rawModes = TokenParser.parse(css);
        const resolved = TokenParser.resolveLinks(rawModes, true);
        
        const token = resolved[0].tokens.find(t => t.name === 'overlay');
        expect(token?.value).toBe('{gray/a1}');
    });
});
