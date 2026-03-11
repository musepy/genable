/**
 * @file figmaNodeData.ts
 * @description Plain Data Representation of a Figma SceneNode.
 * 
 * This acts as the Intermediate Representation (IR) to decouple 
 * our logic from the lived Figma API objects.
 */

export interface FigmaNodeData {
    id: string;
    type: string;
    name: string;
    [key: string]: any;
}

/**
 * Extract raw properties from a Figma SceneNode into a plain object.
 * This handles the "lived object" getters problem.
 */
export function extractFigmaNodeData(node: SceneNode, keys: string[]): FigmaNodeData {
    const data: FigmaNodeData = {
        id: node.id,
        type: node.type,
        name: node.name
    };

    // TextNodes with range-level styles (setRangeFills, setRangeFontSize, etc.)
    // return figma.mixed for node-level property reads. Normalize to 'mixed' sentinel
    // so downstream serializers can render it as `fill:mixed` instead of silently dropping.
    const figmaMixed = typeof figma !== 'undefined' ? figma.mixed : undefined;
    const isMixed = (v: any) => figmaMixed !== undefined && v === figmaMixed;

    keys.forEach(key => {
        if (key in node) {
            const val = (node as any)[key];
            data[key] = isMixed(val) ? 'mixed' : val;
        }
    });

    // Explicit overrides for properties that have special handling
    if ('fontName' in node) {
        data.fontName = isMixed(node.fontName) ? 'mixed' : node.fontName;
    }
    if ('fills' in node) data.fills = isMixed(node.fills) ? 'mixed' : node.fills;
    if ('strokes' in node) data.strokes = isMixed(node.strokes) ? 'mixed' : node.strokes;
    if ('effects' in node) data.effects = isMixed(node.effects) ? 'mixed' : node.effects;

    return data;
}
