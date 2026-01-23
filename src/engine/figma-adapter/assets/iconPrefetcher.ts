/**
 * @file iconPrefetcher.ts
 * @description Pre-fetches SVG content for ICON nodes before sending to main thread
 * 
 * [INPUT]:  NodeLayer tree with ICON nodes or VECTOR nodes with icon-like names
 * [OUTPUT]: NodeLayer tree with ICON nodes converted to VECTOR with svgData
 * [POS]:    UI Thread - must be called BEFORE emitting to main.ts
 * 
 * ARCHITECTURE NOTE:
 * Uses a centralized `resolveIconIdentity` function to enforce Single Source of Truth
 * for what constitutes an "Icon" in the system, handling both explicit types and
 * naming conventions.
 */

import { NodeLayer } from '../../../schema/layerSchema';
import { fetchIconSvg } from './iconify';
import { PROPS } from '../../../constants/figma-api';

interface IconIdentity {
  isIcon: boolean;
  iconName?: string;
  originalProps?: any;
}

/**
 * [SSOT]: Centralized logic to determine if a node represents an Icon
 * and extract its intended icon name.
 * 
 * Strategy Priority:
 * 1. Semantic Tag (Strongest Contract)
 * 2. Explicit Node Type (Legacy Contract)
 * 3. Naming Convention (LLM Heuristic)
 */
function resolveIconIdentity(node: NodeLayer): IconIdentity {
  const props = node.props || {};
  const name = props.name || '';
  const iconNameProp = (props as any).iconName;

  // 1. Check Semantic Tag (Future-proof)
  if (props.semantic === 'ICON') {
    return { 
      isIcon: true, 
      iconName: iconNameProp || name,
      originalProps: props 
    };
  }

  // 2. Check Explicit Type
  if (node.type === 'ICON') {
    return { 
      isIcon: true, 
      iconName: iconNameProp,
      originalProps: props 
    };
  }

  // 3. Check Naming Convention (Heuristic for VECTOR output)
  if (node.type === 'VECTOR') {
    // Iconify format: "collection:icon-name", excluding paths like "foo/bar"
    const isIconifyName = name.includes(':') && !name.includes('/');
    if (isIconifyName) {
      return { 
        isIcon: true, 
        iconName: name, 
        originalProps: props 
      };
    }
  }

  return { isIcon: false };
}

/**
 * Recursively find all ICON nodes in the tree
 */
function findIconNodes(node: NodeLayer, results: NodeLayer[] = []): NodeLayer[] {
  const { isIcon } = resolveIconIdentity(node);
  
  if (isIcon) {
    results.push(node);
  }
  
  if (node.children) {
    for (const child of node.children) {
      findIconNodes(child, results);
    }
  }
  return results;
}

/**
 * Pre-fetch all icon SVGs and convert ICON nodes to VECTOR with embedded svgData
 */
export async function prefetchIconSvgs(layer: NodeLayer): Promise<NodeLayer> {
  const iconNodes = findIconNodes(layer);
  
  if (iconNodes.length === 0) {
    return layer;
  }

  console.log(`[IconPrefetcher] Found ${iconNodes.length} icons to fetch`);

  // Fetch all SVGs in parallel
  const iconNameToSvg = new Map<string, string | null>();
  
  await Promise.all(
    iconNodes.map(async (node) => {
      const { iconName } = resolveIconIdentity(node);
      
      if (iconName && !iconNameToSvg.has(iconName)) {
        // Only fetch if it looks like a valid iconify identifier
        if (iconName.includes(':')) {
           const svg = await fetchIconSvg(iconName);
           iconNameToSvg.set(iconName, svg);
           if (svg) {
             console.log(`[IconPrefetcher] ✓ Fetched: ${iconName}`);
           } else {
             console.warn(`[IconPrefetcher] ✗ Not found: ${iconName}`);
           }
        }
      }
    })
  );

  return transformIcons(layer, iconNameToSvg);
}

/**
 * Recursively transform identified ICON nodes to standardized VECTOR nodes
 */
function transformIcons(
  node: NodeLayer, 
  iconNameToSvg: Map<string, string | null>
): NodeLayer {
  const { isIcon, iconName, originalProps } = resolveIconIdentity(node);

  // If this IS an icon (by any definition), transform it
  if (isIcon) {
    // Prevent re-processing if it already has svgData (idempotency)
    if (node.type === 'VECTOR' && originalProps[PROPS.svgContent]) {
        return node;
    }

    const svg = iconName ? iconNameToSvg.get(iconName) : null;
    
    if (svg) {
      return {
        type: 'VECTOR',
        props: {
          ...originalProps,
          name: iconName || 'icon',
          [PROPS.svgContent]: svg, // [SSOT] Unified property name with LayerRenderer
          width: originalProps.width || 24,
          height: originalProps.height || 24,
        },
        children: undefined // Icons are flattened
      };
    } else {
      // If we identified it as an icon but couldn't fetch data, fallback to placeholder
      return createIconPlaceholder(iconName, originalProps.width, originalProps.height);
    }
  }

  // Not an icon, process children
  if (node.children) {
    return {
      ...node,
      children: node.children.map((child: NodeLayer) => transformIcons(child, iconNameToSvg))
    };
  }

  return node;
}

/**
 * Create a placeholder frame for missing icons
 */
function createIconPlaceholder(iconName: string | undefined, width?: number, height?: number): NodeLayer {
  return {
    type: 'FRAME',
    props: {
      name: `Icon: ${iconName || 'unknown'} (not found)`,
      width: width || 24,
      height: height || 24,
      fills: ['#E5E7EB'],
      cornerRadius: 4,
    },
    children: undefined
  };
}
