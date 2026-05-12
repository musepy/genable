/**
 * @file figmaNodeData.ts
 * @description Plain Data Representation of a Figma SceneNode.
 *
 * This acts as the Intermediate Representation (IR) to decouple
 * our logic from the lived Figma API objects.
 */

import { PROPERTY_REGISTRY } from '../../constants/figma-property-registry';
import { getFacetKeys } from '../../constants/figma-property-registry-helpers';

export interface FigmaNodeData {
    id: string;
    type: string;
    name: string;
    [key: string]: any;
}

/**
 * Extract raw properties from a Figma SceneNode into a plain object.
 *
 * Async because some properties (those with `asyncGetter` in the registry —
 * currently `mainComponent` / `instances`) throw synchronously under Figma's
 * `documentAccess: dynamic-page` mode and require their async variants
 * (e.g. `node.getMainComponentAsync()`).
 *
 * Uses the auto-generated PROPERTY_REGISTRY to discover all properties
 * for the node's type, filtered by role (only 'visual' properties extracted
 * in the registry path).
 *
 * @param node - The Figma node to extract from
 * @param keys - Optional explicit key list (legacy call-sites). When omitted, uses registry.
 */
export async function extractFigmaNodeData(node: SceneNode, keys?: string[]): Promise<FigmaNodeData> {
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

    // Build a lookup of async getters for this node type, so the explicit-keys
    // branch can also honor them.
    const registry = PROPERTY_REGISTRY[node.type];
    const asyncGetterByKey = new Map<string, string>();
    if (registry) {
        for (const prop of registry) {
            if (prop.asyncGetter) asyncGetterByKey.set(prop.key, prop.asyncGetter);
        }
    }

    // Helper: read one key safely, routing async-required props through their async getter.
    const readKey = async (key: string): Promise<void> => {
        if (!(key in node)) return;
        const asyncMethod = asyncGetterByKey.get(key);
        try {
            const val = asyncMethod
                ? await (node as any)[asyncMethod]()
                : (node as any)[key];
            data[key] = isMixed(val) ? 'mixed' : val;
        } catch {
            // Sync getter may throw under dynamic-page mode even when not in our
            // async map (defense in depth); registry path already swallows.
        }
    };

    if (keys) {
        // Legacy path: explicit key list. Sequential await keeps order stable.
        for (const key of keys) {
            await readKey(key);
        }
    } else if (registry) {
        // Registry path: discover all properties for this node type.
        const visualKeys = getFacetKeys(node.type, 'visual');
        for (const prop of registry) {
            if (!visualKeys.has(prop.key)) continue;
            await readKey(prop.key);
        }
    }

    // Explicit overrides for properties that have special handling
    if ('fontName' in node) {
        data.fontName = isMixed(node.fontName) ? 'mixed' : node.fontName;
    }
    if ('fills' in node) data.fills = isMixed(node.fills) ? 'mixed' : node.fills;
    if ('strokes' in node) data.strokes = isMixed(node.strokes) ? 'mixed' : node.strokes;
    if ('effects' in node) data.effects = isMixed(node.effects) ? 'mixed' : node.effects;

    return data;
}
