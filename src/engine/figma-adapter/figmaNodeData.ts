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

    keys.forEach(key => {
        if (key in node) {
            data[key] = (node as any)[key];
        }
    });

    // Special handling for nested/lived objects like fontName
    if ('fontName' in node) data.fontName = node.fontName;
    if ('fills' in node) data.fills = node.fills;
    if ('strokes' in node) data.strokes = node.strokes;
    if ('effects' in node) data.effects = node.effects;

    return data;
}
