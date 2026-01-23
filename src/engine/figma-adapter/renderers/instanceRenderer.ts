/**
 * @file instanceRenderer.ts
 * @description Renderer for INSTANCE nodes (Component Instances)
 * 
 * [INPUT]:  NodeLayer with type: 'INSTANCE' and mainComponentKey
 * [OUTPUT]: Figma InstanceNode
 * [POS]:    Renderers - called by RendererFactory for INSTANCE type
 * 
 * Creates instances of local or library components using their unique key.
 * Supports variant properties for COMPONENT_SET components.
 */

import { NodeLayer, RenderContext, BaseRenderer } from './baseRenderer';

/**
 * Renderer for INSTANCE type nodes
 * Creates component instances from mainComponentKey
 */
export class InstanceRenderer extends BaseRenderer {
    constructor(createPaint: (color: string) => Promise<Paint | null>) {
        super(createPaint);
    }

    protected getRendererName(): string {
        return 'InstanceRenderer';
    }

    protected async createNode(dsl: NodeLayer): Promise<SceneNode | null> {
        const props = dsl.props as {
            mainComponentKey?: string;
            variantProperties?: Record<string, string>;
            width?: number;
            height?: number;
        };

        if (!props.mainComponentKey) {
            console.warn('[InstanceRenderer] Missing mainComponentKey, falling back to placeholder');
            return this.createPlaceholder(props);
        }

        try {
            // Import component by key (works for both local and library components)
            const component = await figma.importComponentByKeyAsync(props.mainComponentKey);
            
            if (!component) {
                console.warn(`[InstanceRenderer] Component not found: ${props.mainComponentKey}`);
                return this.createPlaceholder(props);
            }

            // Create instance
            const instance = component.createInstance();

            // Apply variant properties if it's from a COMPONENT_SET
            if (props.variantProperties && Object.keys(props.variantProperties).length > 0) {
                try {
                    instance.setProperties(props.variantProperties);
                } catch (e) {
                    console.warn('[InstanceRenderer] Failed to set variant properties:', e);
                }
            }

            return instance;
        } catch (e) {
            console.warn(`[InstanceRenderer] Failed to import component: ${props.mainComponentKey}`, e);
            return this.createPlaceholder(props);
        }
    }

    /**
     * Create a placeholder frame when component can't be found
     */
    private createPlaceholder(props: { width?: number; height?: number }): FrameNode {
        const frame = figma.createFrame();
        frame.name = 'Icon Placeholder';
        frame.resize(props.width || 24, props.height || 24);
        frame.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
        frame.cornerRadius = 4;
        return frame;
    }

    protected async applyTypeSpecificProps(
        node: SceneNode,
        dsl: NodeLayer,
        _context: RenderContext
    ): Promise<void> {
        const props = dsl.props as {
            width?: number;
            height?: number;
            layoutSizingHorizontal?: string;
            layoutSizingVertical?: string;
        };

        // Apply size if specified
        if ('resize' in node && (props.width || props.height)) {
            const width = props.width || (node as FrameNode).width;
            const height = props.height || (node as FrameNode).height;
            (node as FrameNode).resize(width, height);
        }

        // ========== Layout Sizing & Flex Fallbacks ==========
        const parentIsAutoLayout = _context.parentLayoutMode !== undefined && _context.parentLayoutMode !== 'NONE';
        const hSizing = props.layoutSizingHorizontal as 'FIXED' | 'HUG' | 'FILL' || 'HUG';
        const vSizing = props.layoutSizingVertical as 'FIXED' | 'HUG' | 'FILL' || 'HUG';

        if (parentIsAutoLayout) {
            if ('layoutSizingHorizontal' in node) {
                (node as any).layoutSizingHorizontal = hSizing;
            }
            if ('layoutSizingVertical' in node) {
                (node as any).layoutSizingVertical = vSizing;
            }

            // Flex grow/stretch fallbacks (for older parents or complex nesting)
            if (_context.parentLayoutMode === 'HORIZONTAL' && hSizing === 'FILL') (node as any).layoutGrow = 1;
            if (_context.parentLayoutMode === 'VERTICAL' && vSizing === 'FILL') (node as any).layoutGrow = 1;
            if (_context.parentLayoutMode === 'HORIZONTAL' && vSizing === 'FILL') (node as any).layoutAlign = 'STRETCH';
            if (_context.parentLayoutMode === 'VERTICAL' && hSizing === 'FILL') (node as any).layoutAlign = 'STRETCH';
        } else if ('layoutSizingHorizontal' in node) {
            // Non-AutoLayout parent: Fallback to FIXED
            (node as any).layoutSizingHorizontal = 'FIXED';
            (node as any).layoutSizingVertical = 'FIXED';
        }
    }
}
