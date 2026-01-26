import { describe, it, expect, beforeEach } from 'vitest';
import { TreeReconstructor } from './treeReconstructor';
import { FlatNode } from '../../schema/layerSchema';
import { NODE_TYPES } from '../../constants/figma-api';

describe('TreeReconstructor Streaming Stability (Reproduction)', () => {
    let reconstructor: TreeReconstructor;

    beforeEach(() => {
        reconstructor = new TreeReconstructor();
    });

    it('reproduces root instability when child arrives before parent', () => {
        // Step 1: Child arrives first (Orphan)
        const chunk1: FlatNode[] = [
            { id: 'child-1', parent: 'root-1', type: NODE_TYPES.TEXT, props: { name: 'Child 1' } }
        ];

        // res1.root will now ALWAYS be a wrapper if forceWrapper is used
        const res1 = reconstructor.reconstruct(chunk1, { 
            wrapperId: 'stable-wrapper',
            forceWrapper: true 
        });
        
        console.log('Chunk 1 Root ID:', res1.root?.id);
        expect(res1.root?.id).toBe('stable-wrapper');

        // Step 2: Parent arrives
        const chunk2: FlatNode[] = [
            { id: 'child-1', parent: 'root-1', type: NODE_TYPES.TEXT, props: { name: 'Child 1' } },
            { id: 'root-1', parent: null, type: NODE_TYPES.FRAME, props: { name: 'Root 1' } }
        ];

        const res2 = reconstructor.reconstruct(chunk2, { 
            wrapperId: 'stable-wrapper',
            forceWrapper: true 
        });
        console.log('Chunk 2 Root ID:', res2.root?.id);

        // STABILITY EXPECTATION:
        expect(res1.root?.id).toBe(res2.root?.id);
        expect(res2.root?.id).toBe('stable-wrapper');
        
        // Structure check
        expect(res2.root?.children?.[0].id).toBe('root-1');
        expect(res2.root?.children?.[0].children?.[0].id).toBe('child-1');
    });

    it('successfully handles orphans during streaming by keeping them top-level in the wrapper', () => {
        const chunk1: FlatNode[] = [
            { id: 'child-1', parent: 'root-1', type: NODE_TYPES.TEXT, props: { name: 'Child 1' } }
        ];

        const res1 = reconstructor.reconstruct(chunk1, { 
            wrapperId: 'stable-wrapper',
            forceWrapper: true 
        });
        
        // Orphan 'child-1' should be a direct child of 'stable-wrapper'
        expect(res1.root?.children?.[0].id).toBe('child-1');
    });
});
