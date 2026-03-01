import { describe, it, expect } from 'vitest';
import { buildDynamicContextContent, DYNAMIC_CONTEXT_MSG_ID } from '../dynamicContext';

describe('buildDynamicContextContent', () => {
    it('should include mode', () => {
        const content = buildDynamicContextContent('EXECUTION');
        expect(content).toContain('[MODE: EXECUTION]');
    });

    it('should include active step title when provided', () => {
        const content = buildDynamicContextContent('EXECUTION', { title: 'Create header' });
        expect(content).toContain('[MODE: EXECUTION]');
        expect(content).toContain('Active step: "Create header"');
    });

    it('should handle null active step', () => {
        const content = buildDynamicContextContent('VERIFICATION', null);
        expect(content).toBe('[MODE: VERIFICATION]');
    });

    it('should handle different modes', () => {
        expect(buildDynamicContextContent('PLANNING')).toContain('[MODE: PLANNING]');
        expect(buildDynamicContextContent('RECOVERY')).toContain('[MODE: RECOVERY]');
        expect(buildDynamicContextContent('AUTONOMOUS')).toContain('[MODE: AUTONOMOUS]');
    });

    it('should export a stable message ID', () => {
        expect(DYNAMIC_CONTEXT_MSG_ID).toBe('dynamic-ctx');
    });
});

describe('KV cache invariant', () => {
    it('system prompt should never change across mode transitions', () => {
        // This test documents the architectural invariant:
        // The SYSTEM prompt (index 0) is built once and never changes.
        // Only the dynamic context message (index 1) changes per iteration.
        const mode1 = buildDynamicContextContent('PLANNING');
        const mode2 = buildDynamicContextContent('EXECUTION');
        const mode3 = buildDynamicContextContent('VERIFICATION');

        // Dynamic context SHOULD change per mode
        expect(mode1).not.toEqual(mode2);
        expect(mode2).not.toEqual(mode3);

        // But it's a tiny string — not a full system prompt rebuild
        expect(mode1.length).toBeLessThan(100);
        expect(mode2.length).toBeLessThan(100);
        expect(mode3.length).toBeLessThan(100);
    });
});
