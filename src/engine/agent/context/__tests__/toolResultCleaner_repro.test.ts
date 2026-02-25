import { describe, it, expect } from 'vitest';
import { ToolResultCleaner } from '../toolResultCleaner';

describe('ToolResultCleaner Repro', () => {
    const tools: any[] = [
        { name: 'batchOperations', parameters: { properties: { operations: { type: 'array' } } } },
        { name: 'applyDesignPatch', parameters: { properties: { patch: { type: 'string' } } } }
    ];
    const cleaner = new ToolResultCleaner(tools);

    it('repro: preserves rollback, diff, and diffInfo even when data is large', () => {
        // Create a large result that would trigger truncation (> 6000 chars)
        const manyResults = Array.from({ length: 50 }, (_, i) => ({
            opId: `op-${i}`,
            action: 'setNodeLayout',
            success: true,
            nodeId: `node-${i}`,
            diff: [`mismatch-${i}`],
            diffInfo: [`[Auto-corrected] info-${i}`],
            extraGarbage: 'x'.repeat(200) // Bloat the size
        }));

        const rawResult = {
            name: 'batchOperations',
            success: false,
            data: {
                results: manyResults,
                idMap: Object.fromEntries(manyResults.map(r => [r.opId, r.nodeId])),
                rollback: {
                    attempted: 5,
                    removed: 3,
                    failed: []
                }
            }
        };

        const cleaned = cleaner.cleanToolResult(rawResult);

        // Verification
        expect(cleaned.data.rollback).toBeDefined();
        expect(cleaned.data.results[0].diff).toBeDefined();
        expect(cleaned.data.results[0].diffInfo).toBeDefined();
        expect(cleaned.data.idMap).toBeDefined();
        expect(typeof cleaned.data.idMap).toBe('object');
        expect(cleaned.data._truncated).toBe(true);
    });

    it('repro: preserves idMap in applyDesignPatch even when result is huge', () => {
        const rawResult = {
            name: 'applyDesignPatch',
            success: true,
            data: {
                results: Array.from({ length: 100 }, (_, i) => ({
                    id: `node-${i}`,
                    success: true
                })),
                idMap: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`logic-${i}`, `node-${i}`])),
                summary: 'Lots of changes...',
                extra: 'y'.repeat(8000) // Trigger brutal truncation
            }
        };

        const cleaned = cleaner.cleanToolResult(rawResult);

        // Current behavior: if stringified size > limit, it returns a summary string instead of object
        // We want it to be an object with idMap preserved
        expect(typeof cleaned.data).toBe('object');
        expect(cleaned.data.idMap).toBeDefined();
        expect(Object.keys(cleaned.data.idMap).length).toBe(100);
    });

    it('repro: preserves visibilityWarnings and diff in regular successful results', () => {
        const rawResult = {
            name: 'setNodeLayout', // Changed from inspectDesign since inspectDesign has a specialized structural path now
            success: true,
            data: {
                nodeId: 'node-1',
                diff: ['mismatch'],
                diffInfo: ['info'],
                visibilityWarnings: [{ message: 'warn' }],
                extra: 'z'.repeat(7000)
            }
        };

        const cleaned = cleaner.cleanToolResult(rawResult);
        expect(cleaned.data.diff).toBeDefined();
        expect(cleaned.data.visibilityWarnings).toBeDefined();
    });
});
