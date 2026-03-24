/**
 * @file compHandlers.ts
 * @description IPC handlers for component/variant management commands.
 * Runs on main thread with full figma component API access.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode, buildNodePath } from './pathResolver';

// ── Main dispatcher ──

export async function handleComp(parameters: any): Promise<ToolResponse> {
  const sub = parameters.subcommand;
  switch (sub) {
    case 'create': return handleCompCreate(parameters);
    case 'combine': return handleCompCombine(parameters);
    case 'prop': return handleCompProp(parameters);
    case 'ls': return handleCompLs(parameters);
    case 'instance': return handleCompInstance(parameters);
    default:
      return {
        error: { code: 'UNKNOWN_SUBCOMMAND', message: `Unknown comp subcommand "${sub}". Use: create, combine, prop, ls, instance` },
      };
  }
}

// ── comp create — convert frame to component ──

async function handleCompCreate(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  if (!paths || paths.length === 0) {
    return { error: { code: 'MISSING_ARG', message: 'Usage: comp create <path>' } };
  }

  const resolved = await resolvePathToNode(paths[0]);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: { code: 'NOT_A_FRAME', message: 'Cannot convert page to component.' } };
  }

  const node = resolved.node;
  if (node.type !== 'FRAME' && node.type !== 'GROUP') {
    if (node.type === 'COMPONENT') {
      return { data: { message: `"${node.name}" is already a component.`, nodeId: node.id } };
    }
    return { error: { code: 'NOT_A_FRAME', message: `"${node.name}" is a ${node.type}, not a frame. Only frames can be converted.` } };
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
      path: buildNodePath(component),
    },
  };
}

// ── comp combine — combine as variant set ──

async function handleCompCombine(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  const setName = params.name as string | undefined;

  if (!paths || paths.length < 2) {
    return { error: { code: 'COMBINE_REQUIRES_2', message: 'Usage: comp combine <path1> <path2> ... [--name Name]. Requires at least 2 components.' } };
  }

  // Resolve all paths to component nodes
  const components: ComponentNode[] = [];
  for (const p of paths) {
    const resolved = await resolvePathToNode(p);
    if (!resolved.ok) return resolved.response;
    if (resolved.isPage) {
      return { error: { code: 'NOT_A_COMPONENT', message: `Page cannot be combined as variant.` } };
    }
    const node = resolved.node;
    if (node.type !== 'COMPONENT') {
      return { error: { code: 'NOT_A_COMPONENT', message: `"${node.name}" is a ${node.type}, not a COMPONENT. Use "comp create" first to convert frames.` } };
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
      path: buildNodePath(componentSet),
      variants: components.map(c => c.name),
    },
  };
}

// ── comp prop — add component property ──

async function handleCompProp(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  const propName = params.name as string;
  const propType = (params.propType as string || '').toUpperCase();
  const defaultValue = params.defaultValue;

  if (!paths || paths.length === 0 || !propName || !propType) {
    return { error: { code: 'MISSING_ARG', message: 'Usage: comp prop <path> <name> TEXT|BOOLEAN|INSTANCE_SWAP [defaultValue]' } };
  }

  const validTypes = ['TEXT', 'BOOLEAN', 'INSTANCE_SWAP'];
  if (!validTypes.includes(propType)) {
    return { error: { code: 'INVALID_TYPE', message: `Invalid property type "${propType}". Use: ${validTypes.join(', ')}` } };
  }

  const resolved = await resolvePathToNode(paths[0]);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: { code: 'NOT_A_COMPONENT', message: 'Cannot add properties to page.' } };
  }

  const node = resolved.node;
  if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
    return { error: { code: 'NOT_A_COMPONENT', message: `"${node.name}" is a ${node.type}. Properties can only be added to COMPONENT or COMPONENT_SET nodes.` } };
  }

  // Determine default value
  let defVal: string | boolean;
  if (propType === 'BOOLEAN') {
    defVal = defaultValue === 'true' || defaultValue === true;
  } else {
    defVal = defaultValue || (propType === 'TEXT' ? propName : '');
  }

  try {
    (node as ComponentNode | ComponentSetNode).addComponentProperty(propName, propType as ComponentPropertyType, defVal);
    return {
      data: {
        message: `Added ${propType} property "${propName}" to "${node.name}" (default: ${defVal})`,
        nodeId: node.id,
      },
    };
  } catch (e: any) {
    return { error: { code: 'PROP_FAILED', message: `Failed: ${e?.message ?? e}` } };
  }
}

// ── comp ls — list component properties ──

async function handleCompLs(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  if (!paths || paths.length === 0) {
    return { error: { code: 'MISSING_ARG', message: 'Usage: comp ls <path>' } };
  }

  const resolved = await resolvePathToNode(paths[0]);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: { code: 'NOT_A_COMPONENT', message: 'Page is not a component.' } };
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
        lines.push(`  ${def.type.padEnd(15)} ${key.padEnd(25)} default=${String(def.defaultValue)}`);
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
        lines.push(`  ${def.type.padEnd(15)} ${key.padEnd(25)} default=${String(def.defaultValue)}`);
      }
    }

    // Check if part of a variant set
    if (comp.parent?.type === 'COMPONENT_SET') {
      lines.push('');
      lines.push(`Part of ComponentSet: ${comp.parent.name} (${(comp.parent as ComponentSetNode).children.length} variants)`);
    }
  } else if (node.type === 'INSTANCE') {
    const inst = node as InstanceNode;
    lines.push(`Instance of: ${inst.mainComponent?.name ?? 'unknown'}`);
    const overrides = inst.componentProperties;
    if (overrides && Object.keys(overrides).length > 0) {
      lines.push('');
      lines.push('Current properties:');
      for (const [key, val] of Object.entries(overrides)) {
        lines.push(`  ${key}: ${val.value} (${val.type})`);
      }
    }
  } else {
    return { error: { code: 'NOT_A_COMPONENT', message: `"${node.name}" is a ${node.type}, not a component/instance.` } };
  }

  return { data: { listing: lines.join('\n') } };
}

// ── comp instance — create instance ──

async function handleCompInstance(params: any): Promise<ToolResponse> {
  const paths = params.paths as string[];
  const parentPath = params.parent as string | undefined;

  if (!paths || paths.length === 0) {
    return { error: { code: 'MISSING_ARG', message: 'Usage: comp instance <component-path> [--parent <dest-path>]' } };
  }

  const resolved = await resolvePathToNode(paths[0]);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: { code: 'NOT_A_COMPONENT', message: 'Page is not a component.' } };
  }

  const node = resolved.node;
  let component: ComponentNode;

  if (node.type === 'COMPONENT') {
    component = node as ComponentNode;
  } else if (node.type === 'COMPONENT_SET') {
    // Use default variant (first child)
    const cs = node as ComponentSetNode;
    if (cs.children.length === 0) {
      return { error: { code: 'NO_VARIANTS', message: 'ComponentSet has no variants.' } };
    }
    component = cs.defaultVariant as ComponentNode;
  } else {
    return { error: { code: 'NOT_A_COMPONENT', message: `"${node.name}" is a ${node.type}, not a component.` } };
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
      path: buildNodePath(instance),
      componentId: component.id,
    },
  };
}
