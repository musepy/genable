/**
 * @file figma.ts
 * @description Utilities for traversing and processing Figma node structures (DSL).
 */

import { NodeLayer } from '../schema/layerSchema';

/**
 * Recursively find the first text content in a layer tree.
 */
export function findTextContent(node: NodeLayer): string {
    if (node.type === 'TEXT') return (node.props as any).content || '';
    if (node.children) {
        for (const child of node.children) {
            const text = findTextContent(child);
            if (text) return text;
        }
    }
    return '';
}

/**
 * Counts total nodes in a DSL tree.
 */
export function countNodes(node: NodeLayer): number {
    let count = 1;
    if (node.children) {
        count += node.children.reduce((acc: number, child: NodeLayer) => acc + countNodes(child), 0);
    }

    return count;
}
