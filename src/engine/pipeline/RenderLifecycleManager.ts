import { LayoutMath } from '../utils/LayoutMath';

/**
 * Manages the lifecycle and physical properties of Figma nodes.
 * Shielding the rest of the engine from Figma API proxy fragility.
 */
export class RenderLifecycleManager {
    /**
     * Safely check if a node is alive and valid.
     */
    public static isNodeAlive(node: any): node is SceneNode {
        if (!node) return false;
        try {
            if (node.removed) return false;
            // Accessing type is the standard way to check proxy validity in Figma
            const _ = node.type;
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Safely remove a node if it exists.
     */
    public static safeRemove(node?: SceneNode): void {
        if (!this.isNodeAlive(node)) return;
        try {
            node.remove();
        } catch (e) {
            console.warn('[RenderLifecycleManager] Failed to remove node:', e);
        }
    }

    /**
     * Resolve the placement context for a new render.
     */
    public static resolvePlacement(
        targetNode: SceneNode | null, 
        existingStreamRoot: SceneNode | null
    ) {
        const isTargetAlive = this.isNodeAlive(targetNode);
        const isStreamAlive = this.isNodeAlive(existingStreamRoot);

        const targetParent = isTargetAlive ? targetNode!.parent : figma.currentPage;
        const targetIndex = (isTargetAlive && targetParent && 'children' in targetParent)
            ? (targetParent as any).children.indexOf(targetNode)
            : undefined;

        let position: { x: number, y: number } | undefined;

        // Priority 1: Keep stream position if it exists
        if (isStreamAlive && 'x' in existingStreamRoot!) {
            position = { x: (existingStreamRoot as any).x, y: (existingStreamRoot as any).y };
        } 
        // Priority 2: Use target node position
        else if (isTargetAlive && 'x' in targetNode!) {
            position = { x: (targetNode as any).x, y: (targetNode as any).y };
        }

        return {
            parent: targetParent as any,
            index: targetIndex,
            position,
            strategy: isTargetAlive ? 'PARENT_CENTER' : 'VIEWPORT'
        };
    }
}
