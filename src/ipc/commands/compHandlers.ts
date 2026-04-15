/**
 * @file compHandlers.ts
 * @description IPC handlers for component/variant management commands.
 * Runs on main thread with full figma component API access.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode } from './pathResolver';
import { traced } from './pipelineTracer';

// ── Helpers ──

/** Strip Figma's internal suffix: "Label#1386:100" → "Label" */
function displayName(internalKey: string): string {
  const idx = internalKey.indexOf('#');
  return idx >= 0 ? internalKey.slice(0, idx) : internalKey;
}

// ── Main dispatcher ──

export const handleComp = traced('handleComp()', 'compHandlers.ts', async function handleComp(parameters: any): Promise<ToolResponse> {
  const sub = parameters.subcommand;
  switch (sub) {
    case 'create': return handleCompCreate(parameters);
    case 'combine': return handleCompCombine(parameters);
    case 'prop': return handleCompProp(parameters);
    case 'ls': return handleCompLs(parameters);
    case 'instance': return handleCompInstance(parameters);
    default:
      return {
        error: `Unknown comp subcommand "${sub}". Use: create, combine, prop, ls, instance`,
      };
  }
});

// ── comp create — convert frame to component ──

export async function handleCompCreate(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  if (!paths || paths.length === 0) {
    return { error: 'Usage: comp create <path>' };
  }

  const resolved = await resolvePathToNode(paths[0]);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: 'Cannot convert page to component.' };
  }

  const node = resolved.node;
  if (node.type !== 'FRAME' && node.type !== 'GROUP') {
    if (node.type === 'COMPONENT') {
      return { data: { message: `"${node.name}" is already a component.`, nodeId: node.id } };
    }
    return { error: `"${node.name}" is a ${node.type}, not a frame. Only frames can be converted.` };
  }

  // Create a new component and transfer all children + properties
  const component = figma.createComponent();
  const parent = node.parent;
  const index = parent ? Array.from((parent as any).children).indexOf(node) : 0;

  // Copy properties from frame to component
  component.name = node.name;
  component.resize(node.width, node.height);
  component.x = node.x;
  component.y = node.y;

  // Copy layout properties
  if ('layoutMode' in node) {
    const frame = node as FrameNode;
    component.layoutMode = frame.layoutMode;
    component.primaryAxisSizingMode = frame.primaryAxisSizingMode;
    component.counterAxisSizingMode = frame.counterAxisSizingMode;
    component.primaryAxisAlignItems = frame.primaryAxisAlignItems;
    component.counterAxisAlignItems = frame.counterAxisAlignItems;
    component.paddingTop = frame.paddingTop;
    component.paddingRight = frame.paddingRight;
    component.paddingBottom = frame.paddingBottom;
    component.paddingLeft = frame.paddingLeft;
    component.itemSpacing = frame.itemSpacing;
    component.counterAxisSpacing = frame.counterAxisSpacing;
    if (frame.layoutWrap) component.layoutWrap = frame.layoutWrap;
    component.clipsContent = frame.clipsContent;
    component.cornerRadius = frame.cornerRadius as number;
    component.fills = JSON.parse(JSON.stringify(frame.fills));
    component.strokes = JSON.parse(JSON.stringify(frame.strokes));
    component.strokeWeight = frame.strokeWeight as number;
    component.effects = JSON.parse(JSON.stringify(frame.effects));
    component.opacity = frame.opacity;
  }

  // Move children from frame to component
  const children = [...(node as FrameNode).children];
  for (const child of children) {
    component.appendChild(child);
  }

  // Insert component at same position in parent
  if (parent && 'insertChild' in parent) {
    (parent as any).insertChild(index, component);
  }

  // Remove the original frame
  node.remove();

  return {
    data: {
      message: `Converted "${component.name}" to component`,
      nodeId: component.id,
      /* path field removed — nodeId above is sufficient */
    },
  };
}

// ── comp combine — combine as variant set ──

export async function handleCompCombine(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  const setName = params.name as string | undefined;

  if (!paths || paths.length < 2) {
    return { error: 'Usage: comp combine <path1> <path2> ... [--name Name]. Requires at least 2 components.' };
  }

  // Resolve all paths to component nodes
  const components: ComponentNode[] = [];
  for (const p of paths) {
    const resolved = await resolvePathToNode(p);
    if (!resolved.ok) return resolved.response;
    if (resolved.isPage) {
      return { error: `Page cannot be combined as variant.` };
    }
    const node = resolved.node;
    if (node.type !== 'COMPONENT') {
      return { error: `"${node.name}" is a ${node.type}, not a COMPONENT. Use "comp create" first to convert frames.` };
    }
    components.push(node as ComponentNode);
  }

  // Determine parent for the variant set
  const setParent = components[0].parent || figma.currentPage;

  // Combine as variants
  const componentSet = figma.combineAsVariants(components, setParent as BaseNode & ChildrenMixin);

  if (setName) {
    componentSet.name = setName;
  }

  // Apply sensible defaults (same pattern as executor.ts)
  componentSet.layoutMode = 'HORIZONTAL';
  componentSet.layoutWrap = 'WRAP';
  componentSet.itemSpacing = 24;
  componentSet.counterAxisSpacing = 24;
  componentSet.paddingTop = 20;
  componentSet.paddingRight = 20;
  componentSet.paddingBottom = 20;
  componentSet.paddingLeft = 20;
  componentSet.primaryAxisSizingMode = 'AUTO';
  componentSet.counterAxisSizingMode = 'AUTO';

  return {
    data: {
      message: `Combined ${components.length} components into variant set "${componentSet.name}"`,
      nodeId: componentSet.id,
      /* path field removed — nodeId above is sufficient */
      variants: components.map(c => c.name),
    },
  };
}

// ── Auto-bind: find matching child node for property binding ──

/**
 * Resolve bind target: explicit ID > auto-find by name match.
 * For TEXT props: finds a text node whose name fuzzy-matches propName.
 * For BOOLEAN props: finds any node whose name fuzzy-matches propName.
 */
async function resolveBindTarget(
  explicitBind: string | undefined,
  propType: string,
  propName: string,
  compNode: SceneNode,
): Promise<SceneNode | null> {
  // Explicit bind target
  if (explicitBind) {
    const resolved = await resolvePathToNode(explicitBind);
    if (resolved.ok && !resolved.isPage) return resolved.node;
  }

  // Auto-find: walk component children, match by name
  const targetType = propType === 'TEXT' ? 'TEXT' : null;
  const candidates: SceneNode[] = [];

  function walk(node: SceneNode) {
    if (targetType && node.type === targetType) {
      candidates.push(node);
    } else if (!targetType && node.type !== 'TEXT') {
      candidates.push(node);
    }
    if ('children' in node) {
      for (const child of (node as FrameNode).children) {
        walk(child);
      }
    }
  }

  if ('children' in compNode) {
    for (const child of (compNode as FrameNode).children) {
      walk(child);
    }
  }

  if (candidates.length === 0) return null;

  // Score by name similarity to propName
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalize(propName);

  // Exact match first
  const exact = candidates.find(c => normalize(c.name) === target);
  if (exact) return exact;

  // Substring match
  const sub = candidates.find(c =>
    normalize(c.name).includes(target) || target.includes(normalize(c.name))
  );
  if (sub) return sub;

  // For TEXT props: match by content (default value)
  if (propType === 'TEXT') {
    for (const c of candidates) {
      if (c.type === 'TEXT') {
        const text = (c as TextNode).characters?.toLowerCase() || '';
        const defLower = (propName).toLowerCase();
        if (text.includes(defLower) || defLower.includes(text.replace(/\s+/g, ''))) {
          return c;
        }
      }
    }
  }

  return null;
}

// ── comp prop — add component property ──

export async function handleCompProp(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  const propName = params.name as string;
  const propType = (params.propType as string || '').toUpperCase();
  const defaultValue = params.defaultValue;
  const bindTarget = params.bindTarget as string | undefined;

  if (!paths || paths.length === 0 || !propName || !propType) {
    return { error: 'Usage: add_component_prop({node, name, type, default?, bind?})' };
  }

  const validTypes = ['TEXT', 'BOOLEAN', 'INSTANCE_SWAP'];
  if (!validTypes.includes(propType)) {
    return { error: `Invalid property type "${propType}". Use: ${validTypes.join(', ')}` };
  }

  const resolved = await resolvePathToNode(paths[0]);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: 'Cannot add properties to page.' };
  }

  const node = resolved.node;
  if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
    return { error: `"${node.name}" is a ${node.type}. Properties can only be added to COMPONENT or COMPONENT_SET nodes.` };
  }

  // Determine default value
  let defVal: string | boolean;
  if (propType === 'BOOLEAN') {
    defVal = defaultValue === 'true' || defaultValue === true;
  } else {
    defVal = defaultValue || (propType === 'TEXT' ? propName : '');
  }

  try {
    const comp = node as ComponentNode | ComponentSetNode;
    comp.addComponentProperty(propName, propType as ComponentPropertyType, defVal);

    // Find the property key assigned by Figma (may differ from propName)
    const propDefs = comp.componentPropertyDefinitions;
    const propKey = Object.keys(propDefs).find(k =>
      k === propName || k.startsWith(propName + '#')
    );

    // Bind property to a child node
    // Priority: explicit bind target > auto-find by name match
    let bound = false;
    let boundNodeId: string | undefined;
    let boundNodeName: string | undefined;

    const bindNode = await resolveBindTarget(bindTarget, propType, propName, node);
    if (bindNode && propKey) {
      try {
        if (propType === 'TEXT' && bindNode.type === 'TEXT') {
          (bindNode as TextNode).componentPropertyReferences = {
            ...(bindNode as TextNode).componentPropertyReferences,
            characters: propKey,
          };
          bound = true;
        } else if (propType === 'BOOLEAN') {
          (bindNode as SceneNode).componentPropertyReferences = {
            ...(bindNode as any).componentPropertyReferences,
            visible: propKey,
          };
          bound = true;
        } else if (propType === 'INSTANCE_SWAP' && bindNode.type === 'INSTANCE') {
          (bindNode as InstanceNode).componentPropertyReferences = {
            ...(bindNode as InstanceNode).componentPropertyReferences,
            mainComponent: propKey,
          };
          bound = true;
        }
        if (bound) {
          boundNodeId = bindNode.id;
          boundNodeName = bindNode.name;
        }
      } catch {
        // Binding failed — property was still created
      }
    }

    const msg = bound
      ? `Added ${propType} property "${propName}" → bound to "${boundNodeName}" (${boundNodeId}) (default: ${defVal})`
      : `Added ${propType} property "${propName}" to "${node.name}" (default: ${defVal}). No matching child found to bind.`;

    return {
      data: {
        message: msg,
        nodeId: node.id,
        property: propName,
        bound,
      },
    };
  } catch (e: any) {
    return { error: `Failed: ${e?.message ?? e}` };
  }
}

// ── comp ls — list component properties ──

export async function handleCompLs(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  if (!paths || paths.length === 0) {
    return { error: 'Usage: comp ls <path>' };
  }

  const resolved = await resolvePathToNode(paths[0]);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: 'Page is not a component.' };
  }

  const node = resolved.node;
  const lines: string[] = [];

  if (node.type === 'COMPONENT_SET') {
    const cs = node as ComponentSetNode;
    lines.push(`ComponentSet: ${cs.name}`);
    lines.push(`Variants: ${cs.children.length}`);
    lines.push('');

    // List variant names
    lines.push('Variants:');
    for (const child of cs.children) {
      lines.push(`  ${child.name}`);
    }
    lines.push('');

    // List properties
    const propDefs = cs.componentPropertyDefinitions;
    if (Object.keys(propDefs).length > 0) {
      lines.push('Properties:');
      for (const [key, def] of Object.entries(propDefs)) {
        lines.push(`  ${def.type.padEnd(15)} ${displayName(key).padEnd(25)} default=${String(def.defaultValue)}`);
      }
    }
  } else if (node.type === 'COMPONENT') {
    const comp = node as ComponentNode;
    lines.push(`Component: ${comp.name}`);
    lines.push(`ID: ${comp.id}`);

    const propDefs = comp.componentPropertyDefinitions;
    if (Object.keys(propDefs).length > 0) {
      lines.push('');
      lines.push('Properties:');
      for (const [key, def] of Object.entries(propDefs)) {
        lines.push(`  ${def.type.padEnd(15)} ${displayName(key).padEnd(25)} default=${String(def.defaultValue)}`);
      }
    }

    // Check if part of a variant set
    if (comp.parent?.type === 'COMPONENT_SET') {
      lines.push('');
      lines.push(`Part of ComponentSet: ${comp.parent.name} (${(comp.parent as ComponentSetNode).children.length} variants)`);
    }
  } else if (node.type === 'INSTANCE') {
    const inst = node as InstanceNode;
    const mainComp = await inst.getMainComponentAsync();
    lines.push(`Instance of: ${mainComp?.name ?? 'unknown'}`);
    const overrides = inst.componentProperties;
    if (overrides && Object.keys(overrides).length > 0) {
      lines.push('');
      lines.push('Current properties:');
      for (const [key, val] of Object.entries(overrides)) {
        lines.push(`  ${displayName(key)}: ${val.value} (${val.type})`);
      }
    }
  } else {
    return { error: `"${node.name}" is a ${node.type}, not a component/instance.` };
  }

  return { data: { listing: lines.join('\n') } };
}

// ── comp instance — create instance ──

export async function handleCompInstance(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  const parentPath = params.parent as string | undefined;

  if (!paths || paths.length === 0) {
    return { error: 'Usage: comp instance <component-path> [--parent <dest-path>]' };
  }

  const resolved = await resolvePathToNode(paths[0]);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: 'Page is not a component.' };
  }

  const node = resolved.node;
  let component: ComponentNode;

  if (node.type === 'COMPONENT') {
    component = node as ComponentNode;
  } else if (node.type === 'COMPONENT_SET') {
    // Use default variant (first child)
    const cs = node as ComponentSetNode;
    if (cs.children.length === 0) {
      return { error: 'ComponentSet has no variants.' };
    }
    component = cs.defaultVariant as ComponentNode;
  } else {
    return { error: `"${node.name}" is a ${node.type}, not a component.` };
  }

  const instance = component.createInstance();

  // Move to parent if specified
  if (parentPath) {
    const parentResolved = await resolvePathToNode(parentPath);
    if (!parentResolved.ok) return parentResolved.response;
    const parent = parentResolved.isPage ? figma.currentPage : parentResolved.node;
    if ('appendChild' in parent) {
      (parent as any).appendChild(instance);
    }
  }

  return {
    data: {
      message: `Created instance of "${component.name}"`,
      nodeId: instance.id,
      /* path field removed — nodeId above is sufficient */
      componentId: component.id,
    },
  };
}
