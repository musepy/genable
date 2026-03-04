import { describe, it, expect } from 'vitest';
import { buildDynamicContextContent, DYNAMIC_CONTEXT_MSG_ID } from '../dynamicContext';

describe('buildDynamicContextContent', () => {
    it('should include iteration count', () => {
        const content = buildDynamicContextContent(0, 40);
        expect(content).toContain('[Iteration 1/40]');
    });

    it('should reflect current iteration', () => {
        const content = buildDynamicContextContent(9, 40);
        expect(content).toContain('[Iteration 10/40]');
    });

    it('should work with different max iterations', () => {
        const content = buildDynamicContextContent(0, 20);
        expect(content).toContain('[Iteration 1/20]');
    });

    it('should export a stable message ID', () => {
        expect(DYNAMIC_CONTEXT_MSG_ID).toBe('dynamic-ctx');
    });
});

describe('KV cache invariant', () => {
    it('dynamic context changes per iteration but remains tiny', () => {
        const iter1 = buildDynamicContextContent(0, 40);
        const iter2 = buildDynamicContextContent(1, 40);
        const iter3 = buildDynamicContextContent(2, 40);

        // Dynamic context SHOULD change per iteration
        expect(iter1).not.toEqual(iter2);
        expect(iter2).not.toEqual(iter3);

        // But it's a tiny string — not a full system prompt rebuild
        expect(iter1.length).toBeLessThan(50);
        expect(iter2.length).toBeLessThan(50);
        expect(iter3.length).toBeLessThan(50);
    });
});
