/**
 * @file surgicalBinding.ts
 * @description Shared icon color binding logic (Surgical Binding v5.4)
 * 
 * This module provides the core algorithm for dyeing icons with semantic colors.
 * It must be used by BOTH IconRenderer and VectorRenderer to ensure consistency.
 * 
 * [HISTORY]
 * - V1-V5.3: Logic was duplicated across renderers, causing black stroke bug
 * - V5.4: Extracted to shared module after postmortem analysis
 */

/**
 * Apply semantic color to all fills and strokes in an SVG node tree.
 * 
 * Rules:
 * 1. Fills: Skip white/transparent (negative space preservation)
 * 2. Strokes: UNCONDITIONALLY dye (Lucide icons are stroke-based)
 * 3. Geometry: Traverse ALL node types with fills/strokes
 * 
 * @param rootNode - The root node to traverse (usually a FrameNode from createNodeFromSvg)
 * @param paint - The semantic Paint to apply
 */
export function applySurgicalBinding(rootNode: SceneNode, paint: Paint): void {
    const applyRecursive = (target: SceneNode) => {
        // Broad target: any node with color properties
        if ('fills' in target || 'strokes' in target) {
            const v = target as any;
            
            // === FILL DYEING (with negative space protection) ===
            // V5.5 BUGFIX: Only dye fills for non-frame nodes (Vectors/Paths)
            // If we dye a frame's fill, it colors the entire icon background.
            if (v.fills && v.fills !== figma.mixed && v.fills.length > 0 && target.type !== 'FRAME') {
                const isNonWhite = v.fills.some((p: Paint) => {
                    if (p.type !== 'SOLID') return true;
                    const { r, g, b } = (p as SolidPaint).color;
                    const op = (p as SolidPaint).opacity ?? 1;
                    if (op === 0) return false;
                    return !(r > 0.9 && g > 0.9 && b > 0.9);
                });
                if (isNonWhite) {
                    v.fills = [paint];
                }
            }
            
            // === STROKE DYEING (UNCONDITIONAL for existing strokes) ===
            // Lucide icons use stroke="currentColor" which Figma renders as black.
            // We MUST overwrite all strokes to achieve monochromatic icons.
            if ('strokes' in v && Array.isArray(v.strokes) && v.strokes.length > 0) {
                v.strokes = [paint];
            }
        }

        // Recurse into children
        if ('children' in target) {
            for (const child of (target as any).children) {
                applyRecursive(child);
            }
        }
    };

    applyRecursive(rootNode);
}

/**
 * Apply stroke weight to all stroke-based paths in an SVG node tree.
 * 
 * @param rootNode - The root node to traverse
 * @param weight - The stroke weight to apply (in pixels)
 */
export function applyStrokeWeight(rootNode: SceneNode, weight: number): void {
    const applyRecursive = (target: SceneNode) => {
        if ('strokes' in target) {
            const v = target as any;
            if (Array.isArray(v.strokes) && v.strokes.length > 0) {
                v.strokeWeight = weight;
            }
        }
        if ('children' in target) {
            for (const child of (target as any).children) {
                applyRecursive(child);
            }
        }
    };

    applyRecursive(rootNode);
}

/**
 * Calculate adaptive stroke weight based on icon size.
 * Standard: 2px at 24px, min 1.5px for clarity.
 * 
 * @param iconSize - The icon width/height in pixels
 * @returns Calculated stroke weight
 */
export function calculateAdaptiveWeight(iconSize: number): number {
    return Math.max(1.5, (iconSize / 24) * 2);
}

// ==========================================
// V6 PHASE P1: INSTANCE BUILDER
// ==========================================

export interface ComponentMap {
    name: string;
    key: string;
    nodeId: string;
}

/**
 * Attempts to swap a generated frame with a physical Component Instance
 * 
 * @param frame - The generated FrameNode
 * @param semanticType - The inferred semantic type (e.g. "BUTTON")
 * @param localComponents - List of available local components
 */
export async function swapWithInstance(
    frame: FrameNode, 
    semanticType: string,
    localComponents: ComponentMap[]
): Promise<InstanceNode | null> {
    // 1. Precise Match: Search for a component whose name matches the frame name or semantic intent
    const frameNameLower = String(frame.name || '').toLowerCase();
    const semanticTypeLower = String(semanticType || '').toLowerCase();

    const target = localComponents.find(c => {
        const componentNameLower = String(c.name || '').toLowerCase();
        return componentNameLower === frameNameLower || componentNameLower === semanticTypeLower;
    });

    if (!target) return null;

    try {
        // 2. Fetch the actual ComponentNode from the document
        const master = await figma.getNodeByIdAsync(target.nodeId) as ComponentNode | ComponentSetNode;
        if (!master) return null;

        // If it's a ComponentSet, pick the "Default" or first variant
        const componentToInstantiate = master.type === 'COMPONENT_SET' ? master.defaultVariant : master;

        // 3. Create Instance
        const instance = componentToInstantiate.createInstance();
        
        // 4. Position and Resize to match the generated frame
        instance.x = frame.x;
        instance.y = frame.y;
        if (frame.layoutSizingHorizontal === 'FIXED') instance.resize(frame.width, instance.height);
        if (frame.layoutSizingVertical === 'FIXED') instance.resize(instance.width, frame.height);
        
        // Copy Layout Sizing
        instance.layoutSizingHorizontal = frame.layoutSizingHorizontal;
        instance.layoutSizingVertical = frame.layoutSizingVertical;

        // 5. [FUTURE]: Intelligent slot binding (recursive mapping of children)
        
        return instance;
    } catch (e) {
        console.error(`[surgicalBinding] Swapping failed for ${frame.name}:`, e);
        return null;
    }
}
