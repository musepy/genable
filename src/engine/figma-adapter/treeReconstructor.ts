import { NODE_TYPES } from '../../constants/figma-api';

export type NodeLayer = {
    id?: string;
    type: string;
    props: Record<string, any>;
    children?: NodeLayer[];
};

export type FlatNode = {
    id: string;
    parent: string | null;
    type: string;
    props: Record<string, any>;
};

/**
 * Result of the reconstruction process
 */
export interface ReconstructionResult {
    root: NodeLayer | null;
    errors: string[];
    warnings: string[];
}

/**
 * TreeReconstructor
 * 
 * Logic to convert an Adjacency List (flat array of nodes) into 
 * a recursive tree structure (NodeLayer) for rendering.
 * 
 * Principle: O(N) single-pass mapping with robust recovery logic.
 */
export class TreeReconstructor {
    /**
     * Converts an array of FlatNode objects into a single NodeLayer tree.
     * 
     * @param nodes - Array of flat nodes from the LLM
     * @param options - Additional options for reconstruction
     * @returns ReconstructionResult containing the root node and any issues
     */
    reconstruct(nodes: FlatNode[], options?: { wrapperId?: string, forceWrapper?: boolean }): ReconstructionResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const nodeMap = new Map<string, NodeLayer>();
        const roots: NodeLayer[] = [];

        if (!nodes || nodes.length === 0) {
            return { root: null, errors: ['No nodes provided for reconstruction'], warnings: [] };
        }

        // Pass 1: Initialize the map and detect duplicates
        // This ensures all nodes exist in the map before we try to link them.
        for (const node of nodes) {
            if (!node.id) {
                errors.push('Node missing ID. Skipping.');
                continue;
            }

            if (nodeMap.has(node.id)) {
                warnings.push(`Duplicate ID detected: "${node.id}". The latest definition will be used.`);
            }

            const restProps = node.props as any;

            // Create the NodeLayer object (shallow copy of props, empty children)
            const nodeLayer: NodeLayer = {
                id: node.id,
                type: node.type,
                props: { 
                    name: (node.props as any).name || node.id, // [FIX] Preserve ID as layer name
                    ...restProps 
                },
                children: []
            };

            nodeMap.set(node.id, nodeLayer);
        }

        // Pass 2: Establish parent-child relationships
        const rootIds = new Set<string>();

        for (const node of nodes) {
            const current = nodeMap.get(node.id);
            if (!current) continue;

            // Root detection
            if (node.parent === null || node.parent === '' || node.parent === undefined) {
                if (!rootIds.has(node.id)) {
                    roots.push(current);
                    rootIds.add(node.id);
                }
                continue;
            }

            // Relational linking
            const parent = nodeMap.get(node.parent);
            if (parent) {
                parent.children = parent.children || [];
                parent.children.push(current);
            } else if (node.parent !== null && node.parent !== '' && node.parent !== undefined) {
                // [Robustness] Orphan recovery: promote orphan to root
                // Only warn if the parent was supposed to exist but didn't
                warnings.push(`Orphan node "${node.id}": Parent "${node.parent}" not found. Promoting to root.`);
                roots.push(current);
            }
        }

        // Pass 3: Final structural check
        if (roots.length === 0) {
            errors.push('No root node detected and reconstruction failed to find a valid entry point.');
            return { root: null, errors, warnings };
        }

        if (roots.length > 1 || options?.forceWrapper) {
            if (roots.length > 1) {
                warnings.push(`${roots.length} root-level nodes detected. Wrapping in a container frame.`);
            }
            const wrapper: NodeLayer = {
                id: options?.wrapperId || 'stream-root-wrapper',
                type: NODE_TYPES.FRAME,
                props: { 
                    name: 'Generated Layout',
                    semantic: 'STREAM_WRAPPER' 
                },
                children: roots
            };
            return { root: wrapper, errors, warnings };
        }

        return { root: roots[0], errors, warnings };
    }
}
