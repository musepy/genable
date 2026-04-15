export const nodeRegistry = new Map<string, SceneNode>();

export function clearRegistry(): void {
    nodeRegistry.clear();
}

export function registerNode(id: string, node: SceneNode): void {
    nodeRegistry.set(id, node);
}

export function isNodeManaged(node: SceneNode): boolean {
    let managed = false;
    nodeRegistry.forEach((managedNode) => {
        if (managedNode === node) managed = true;
    });
    return managed;
}

export async function findNodeByIdAsync(id: string): Promise<SceneNode | null> {
    const node = nodeRegistry.get(id);
    if (node) {
        try {
            if (node.removed) throw new Error('removed');
            const _ = node.type; 
            return node;
        } catch (e) {
            nodeRegistry.delete(id);
        }
    }
    
    try {
        const figmaNode = await figma.getNodeByIdAsync(id);
        if (figmaNode && figmaNode.type !== 'DOCUMENT' && figmaNode.type !== 'PAGE') {
            return figmaNode as SceneNode;
        }
    } catch (e) {
    }
    
    return null;
}
