import { describe, it, expect } from 'vitest';
import { TreeReconstructor } from './treeReconstructor';
import { FlatNode } from '../../schema/layerSchema';
import { NODE_TYPES } from '../../constants/figma-api';

describe('TreeReconstructor', () => {
    const reconstructor = new TreeReconstructor();

    it('should reconstruct a simple tree correctly', () => {
        const nodes: FlatNode[] = [
            { id: '1', parent: null, type: NODE_TYPES.FRAME, props: { name: 'Root' } },
            { id: '2', parent: '1', type: NODE_TYPES.TEXT, props: { name: 'Child' } }
        ];

        const { root, errors } = reconstructor.reconstruct(nodes);

        expect(errors).toHaveLength(0);
        expect(root).toBeDefined();
        expect(root?.props.name).toBe('Root');
        expect(root?.children).toHaveLength(1);
        expect(root?.children?.[0].props.name).toBe('Child');
    });

    it('should promote orphans to root (Robustness)', () => {
        const nodes: FlatNode[] = [
            { id: 'root', parent: null, type: NODE_TYPES.FRAME, props: { name: 'Root' } },
            { id: 'orphan', parent: 'non-existent', type: NODE_TYPES.TEXT, props: { name: 'Orphan' } }
        ];

        const { root, warnings } = reconstructor.reconstruct(nodes);

        expect(warnings).toContain('Orphan node "orphan": Parent "non-existent" not found. Promoting to root.');
        expect(root?.type).toBe(NODE_TYPES.FRAME);
        expect(root?.children).toHaveLength(2); // Root + promoted Orphan inside the virtual wrapper
    });

    it('should NOT generate orphan warnings for parent: null', () => {
        const nodes: FlatNode[] = [
            { id: 'root', parent: null, type: NODE_TYPES.FRAME, props: { name: 'Root' } }
        ];

        const { root, warnings } = reconstructor.reconstruct(nodes);

        expect(warnings).toHaveLength(0);
        expect(root?.id).toBe('root');
    });

    it('should wrap multiple roots in a container', () => {
        const nodes: FlatNode[] = [
            { id: 'r1', parent: null, type: NODE_TYPES.FRAME, props: { name: 'Root 1' } },
            { id: 'r2', parent: null, type: NODE_TYPES.FRAME, props: { name: 'Root 2' } }
        ];

        const { root, warnings } = reconstructor.reconstruct(nodes);

        expect(warnings).toContain('2 root-level nodes detected. Wrapping in a container frame.');
        expect(root?.children).toHaveLength(2);
        expect(root?.props.name).toBe('Generated Layout');
    });

    it('should handle duplicate IDs gracefully (use the latest)', () => {
        const nodes: FlatNode[] = [
            { id: '1', parent: null, type: NODE_TYPES.FRAME, props: { name: 'Original' } },
            { id: '1', parent: null, type: NODE_TYPES.FRAME, props: { name: 'Duplicate' } }
        ];

        const { root, warnings } = reconstructor.reconstruct(nodes);

        expect(warnings).toContain('Duplicate ID detected: "1". The latest definition will be used.');
        expect(root?.props.name).toBe('Duplicate');
    });

    it('should return error if no nodes are provided', () => {
        const { root, errors } = reconstructor.reconstruct([]);
        expect(root).toBeNull();
        expect(errors).toContain('No nodes provided for reconstruction');
    });
});
