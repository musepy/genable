/**
 * @file varHandlers.ts
 * @description IPC handlers for variable management commands.
 * Runs on main thread with full figma.variables.* API access.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode } from './pathResolver';
import { parseHexToRGBA, rgbaToHex } from '../../utils/colorUtils';
import { invalidateVariableCache } from '../../engine/actions/handlers/variableBindingHandler';
import { figmaVariableCache } from '../../engine/figma-adapter/caches/figmaVariableCache';

// ── Main dispatcher ──

export async function handleVar(parameters: any): Promise<ToolResponse> {
  const sub = parameters.subcommand;
  switch (sub) {
    case 'ls': return handleVarLs(parameters);
    case 'mk': return handleVarMk(parameters);
    case 'mk-collection': return handleVarMkCollection(parameters);
    case 'bind': return handleVarBind(parameters);
    case 'alias': return handleVarAlias(parameters);
    default:
      return {
        error: `Unknown var subcommand "${sub}". Use: ls, mk, bind, alias`,
      };
  }
}

// ── var ls ──

export async function handleVarLs(params: any): Promise<ToolResponse> {
  const filterCollection = params.collection as string | undefined;
  const verbose = params.verbose as boolean | undefined;

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const allVariables = await figma.variables.getLocalVariablesAsync();

  if (collections.length === 0) {
    return { data: { listing: '(no variable collections)', count: 0 } };
  }

  const lines: string[] = [];
  let totalVars = 0;

  for (const coll of collections) {
    if (filterCollection && !coll.name.toLowerCase().includes(filterCollection.toLowerCase())) continue;

    const collVars = allVariables.filter(v => v.variableCollectionId === coll.id);
    const modeNames = coll.modes.map(m => m.name).join(', ');
    lines.push(`📁 ${coll.name}  (${collVars.length} vars, modes: ${modeNames})`);
    totalVars += collVars.length;

    if (!filterCollection && !verbose) {
      // No collection specified → summary only (collection names + counts)
      continue;
    }

    if (!verbose && collVars.length > 30) {
      // Collection specified but too many vars → grouped summary
      const groups = new Map<string, { count: number; types: Set<string>; examples: string[] }>();
      for (const v of collVars) {
        // Group by all segments except the last (e.g. "Colors/Gray/1" → "Colors/Gray")
        const lastSlash = v.name.lastIndexOf('/');
        const groupName = lastSlash > 0 ? v.name.slice(0, lastSlash) : '(root)';
        if (!groups.has(groupName)) groups.set(groupName, { count: 0, types: new Set(), examples: [] });
        const g = groups.get(groupName)!;
        g.count++;
        g.types.add(v.resolvedType);
        if (g.examples.length < 2) {
          const val = formatVarValue(v.valuesByMode[coll.modes[0].modeId], v.resolvedType, allVariables);
          g.examples.push(`${v.name.slice(lastSlash + 1)}=${val}`);
        }
      }
      for (const [groupName, g] of groups) {
        const types = [...g.types].join(',');
        lines.push(`  ${groupName.padEnd(30)} ${String(g.count).padStart(3)} ${types.padEnd(7)}  e.g. ${g.examples.join(', ')}`);
      }
      lines.push(`  ── ${groups.size} groups. Use: var ls "${coll.name}" -v  for full listing`);
      lines.push('');
      continue;
    }

    // Verbose mode or small collection → full listing
    for (const v of collVars) {
      const values: string[] = [];
      for (const mode of coll.modes) {
        const val = v.valuesByMode[mode.modeId];
        const formatted = formatVarValue(val, v.resolvedType, allVariables);
        if (coll.modes.length === 1) {
          values.push(formatted);
        } else {
          values.push(`${mode.name}=${formatted}`);
        }
      }
      lines.push(`  ${v.resolvedType.padEnd(7)}  ${v.name.padEnd(30)}  ${values.join('  ')}`);
    }
    lines.push('');
  }

  if (!filterCollection && !verbose) {
    lines.push(`── ${collections.length} collections, ${totalVars} variables total. Use: var ls <collection>  to explore.`);
  }

  return {
    data: {
      listing: lines.join('\n'),
      count: totalVars,
      collections: collections.length,
    },
  };
}

// ── var mk (create variable or set value) ──

export async function handleVarMk(params: any): Promise<ToolResponse> {
  const varPath = params.variable as string;
  const rawType = params.varType as string | undefined;
  const rawValue = params.value as string | undefined;
  const modeName = params.mode as string | undefined;

  if (!varPath) {
    return { error: 'Usage: var mk <collection/name> <TYPE> <value>' };
  }

  // Parse collection/name from path
  const slashIdx = varPath.indexOf('/');
  if (slashIdx < 0) {
    return { error: 'Variable path must include collection: var mk <collection/name> <TYPE> <value>' };
  }
  const collectionName = varPath.slice(0, slashIdx);
  const variableName = varPath.slice(slashIdx + 1);

  // Find or create collection
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find(c => c.name.toLowerCase() === collectionName.toLowerCase());
  let createdCollection = false;

  if (!collection) {
    collection = figma.variables.createVariableCollection(collectionName);
    createdCollection = true;
  }

  // Determine type
  const type = normalizeVarType(rawType || guessType(rawValue || '', varPath));
  if (!type) {
    return { error: `Cannot determine variable type. Specify explicitly: var mk ${varPath} COLOR|FLOAT|BOOLEAN|STRING <value>` };
  }

  // Find or create variable
  const allVars = await figma.variables.getLocalVariablesAsync();
  const collVars = allVars.filter(v => v.variableCollectionId === collection!.id);
  let variable = collVars.find(v => v.name === variableName);
  let createdVariable = false;

  if (!variable) {
    variable = figma.variables.createVariable(variableName, collection, type);
    createdVariable = true;
  }

  // Set value if provided
  if (rawValue !== undefined) {
    const figmaValue = parseValueForFigma(rawValue, type);
    if (figmaValue === undefined) {
      return { error: `Cannot parse "${rawValue}" as ${type}.` };
    }

    if (modeName) {
      // Set for specific mode
      const mode = collection.modes.find(m => m.name.toLowerCase() === modeName.toLowerCase());
      if (!mode) {
        return { error: `Mode "${modeName}" not found in collection "${collection.name}". Available: ${collection.modes.map(m => m.name).join(', ')}` };
      }
      variable.setValueForMode(mode.modeId, figmaValue);
    } else {
      // Set for all modes (or default mode)
      for (const mode of collection.modes) {
        variable.setValueForMode(mode.modeId, figmaValue);
      }
    }
  }

  // Invalidate caches
  invalidateCaches();

  const actions: string[] = [];
  if (createdCollection) actions.push(`created collection "${collectionName}"`);
  if (createdVariable) actions.push(`created ${type} variable "${variableName}"`);
  if (rawValue !== undefined) actions.push(`set value = ${rawValue}${modeName ? ` (mode: ${modeName})` : ''}`);

  return {
    data: {
      message: actions.join(', '),
      variableId: variable.id,
      collection: collection.name,
      variable: variable.name,
      type,
    },
  };
}

// ── var mk --collection (create collection with modes) ──

export async function handleVarMkCollection(params: any): Promise<ToolResponse> {
  const collName = params.collection as string;
  const modesStr = params.modes as string | undefined;

  if (!collName) {
    return { error: 'Usage: var mk --collection <name> [--modes Light,Dark]' };
  }

  // Check if collection already exists
  const existing = await figma.variables.getLocalVariableCollectionsAsync();
  const found = existing.find(c => c.name.toLowerCase() === collName.toLowerCase());
  if (found) {
    return {
      data: {
        message: `Collection "${found.name}" already exists`,
        collectionId: found.id,
        modes: found.modes.map(m => ({ name: m.name, id: m.modeId })),
      },
    };
  }

  const collection = figma.variables.createVariableCollection(collName);

  // Handle modes
  if (modesStr) {
    const modeNames = modesStr.split(',').map(m => m.trim()).filter(Boolean);
    if (modeNames.length > 0) {
      // Rename default "Mode 1" to first mode name
      collection.renameMode(collection.modes[0].modeId, modeNames[0]);
      // Add remaining modes
      for (let i = 1; i < modeNames.length; i++) {
        collection.addMode(modeNames[i]);
      }
    }
  }

  invalidateCaches();

  return {
    data: {
      message: `Created collection "${collName}" with modes: ${collection.modes.map(m => m.name).join(', ')}`,
      collectionId: collection.id,
      modes: collection.modes.map(m => ({ name: m.name, id: m.modeId })),
    },
  };
}

// ── var bind ──

export async function handleVarBind(params: any): Promise<ToolResponse> {
  const nodePath = params.nodePath as string;
  const property = params.property as string;
  const varPath = params.variable as string;

  if (!nodePath || !property || !varPath) {
    return { error: 'Usage: var bind <node-path> <property> <collection/varName>' };
  }

  // Resolve node
  const resolved = await resolvePathToNode(nodePath);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: 'Cannot bind variables to a page node.' };
  }
  const node = resolved.node;

  // Find variable
  const variable = await findVariableByPath(varPath);
  if (!variable) {
    return { error: `Variable "${varPath}" not found. Use "var ls" to list available variables.` };
  }

  // Bind
  const normalizedProp = normalizeBindProperty(property);
  try {
    if (isPaintProperty(normalizedProp)) {
      // Color variable → paint binding
      const paint = figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 } },
        'color',
        variable,
      );
      (node as any)[normalizedProp] = [paint];
    } else {
      // Numeric / boolean / string → direct binding
      node.setBoundVariable(normalizedProp as VariableBindableNodeField, variable);
    }

    return {
      data: {
        message: `Bound "${variable.name}" (${variable.resolvedType}) → ${node.name}.${normalizedProp}`,
        nodeId: node.id,
        variableId: variable.id,
      },
    };
  } catch (e: any) {
    return {
      error: `Failed to bind: ${e?.message ?? e}`,
    };
  }
}

// ── var alias ──

export async function handleVarAlias(params: any): Promise<ToolResponse> {
  const sourceVarPath = params.variable as string;
  const targetVarPath = params.target as string;

  if (!sourceVarPath || !targetVarPath) {
    return { error: 'Usage: var alias <semantic/name> <target/name>' };
  }

  // Find target variable
  const targetVar = await findVariableByPath(targetVarPath);
  if (!targetVar) {
    return { error: `Target variable "${targetVarPath}" not found.` };
  }

  // Parse source path
  const slashIdx = sourceVarPath.indexOf('/');
  if (slashIdx < 0) {
    return { error: 'Alias path must include collection: var alias <collection/name> <target>' };
  }
  const collectionName = sourceVarPath.slice(0, slashIdx);
  const variableName = sourceVarPath.slice(slashIdx + 1);

  // Find or create collection
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find(c => c.name.toLowerCase() === collectionName.toLowerCase());
  if (!collection) {
    collection = figma.variables.createVariableCollection(collectionName);
  }

  // Find or create source variable
  const allVars = await figma.variables.getLocalVariablesAsync();
  const collVars = allVars.filter(v => v.variableCollectionId === collection!.id);
  let sourceVar = collVars.find(v => v.name === variableName);

  if (!sourceVar) {
    sourceVar = figma.variables.createVariable(variableName, collection, targetVar.resolvedType);
  }

  // Set alias for all modes
  const alias = figma.variables.createVariableAlias(targetVar);
  for (const mode of collection.modes) {
    sourceVar.setValueForMode(mode.modeId, alias);
  }

  invalidateCaches();

  return {
    data: {
      message: `Created alias: ${sourceVarPath} → ${targetVarPath}`,
      sourceId: sourceVar.id,
      targetId: targetVar.id,
    },
  };
}

// ── Helpers ──

function invalidateCaches(): void {
  invalidateVariableCache();
  figmaVariableCache.invalidate();
}

/** Find a variable by path (collection/name or just name with suffix matching). */
async function findVariableByPath(varPath: string): Promise<Variable | null> {
  const allVars = await figma.variables.getLocalVariablesAsync();
  const lower = varPath.toLowerCase();

  // 1. Exact match on full name within any collection
  // The varPath might be "collection/name" — match against var.name which is just the "name" part
  // First try matching against collection-prefixed name
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collMap = new Map(collections.map(c => [c.id, c.name]));

  for (const v of allVars) {
    const collName = collMap.get(v.variableCollectionId) || '';
    const fullPath = `${collName}/${v.name}`.toLowerCase();
    if (fullPath === lower) return v;
  }

  // 2. Match against just variable name (without collection prefix)
  const nameOnly = varPath.includes('/') ? varPath.slice(varPath.indexOf('/') + 1) : varPath;
  for (const v of allVars) {
    if (v.name.toLowerCase() === nameOnly.toLowerCase()) return v;
  }

  // 3. Suffix match
  for (const v of allVars) {
    if (v.name.toLowerCase().endsWith(lower) || lower.endsWith(v.name.toLowerCase())) return v;
  }

  return null;
}

function normalizeVarType(raw: string): VariableResolvedDataType | null {
  const t = raw.toUpperCase();
  if (t === 'COLOR' || t === 'COLOUR') return 'COLOR';
  if (t === 'FLOAT' || t === 'NUMBER' || t === 'DIMENSION') return 'FLOAT';
  if (t === 'BOOLEAN' || t === 'BOOL') return 'BOOLEAN';
  if (t === 'STRING' || t === 'TEXT') return 'STRING';
  return null;
}

function guessType(value: string, name: string): string {
  const v = value.toLowerCase();
  if (v.startsWith('#') || v.startsWith('rgb')) return 'COLOR';
  if (v === 'true' || v === 'false') return 'BOOLEAN';
  if (!isNaN(parseFloat(value.replace('px', '')))) return 'FLOAT';

  const n = name.toLowerCase();
  if (n.includes('color') || n.includes('bg') || n.includes('fill') || n.includes('stroke')) return 'COLOR';
  if (n.includes('size') || n.includes('space') || n.includes('radius') || n.includes('gap') || n.includes('padding')) return 'FLOAT';

  return 'STRING';
}

function parseValueForFigma(value: string, type: VariableResolvedDataType): any {
  if (type === 'COLOR') return parseHexToRGBA(value);
  if (type === 'FLOAT') return parseFloat(value.replace('px', ''));
  if (type === 'BOOLEAN') return value.toLowerCase() === 'true';
  return value; // STRING
}

function formatVarValue(val: any, type: VariableResolvedDataType, allVars: Variable[]): string {
  if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
    const target = allVars.find(v => v.id === val.id);
    return target ? `→ ${target.name}` : '→ ?';
  }
  if (type === 'COLOR') {
    const rgba = val as { r: number; g: number; b: number; a?: number };
    if (!rgba || typeof rgba.r !== 'number') return '#???';
    return rgbaToHex(rgba);
  }
  if (type === 'FLOAT') return `${val}`;
  return String(val);
}

const PAINT_PROPS = new Set(['fills', 'strokes']);

function isPaintProperty(prop: string): boolean {
  return PAINT_PROPS.has(prop);
}

/** Map common shorthand property names to Figma bindable fields. */
function normalizeBindProperty(prop: string): string {
  const map: Record<string, string> = {
    bg: 'fills',
    fill: 'fills',
    stroke: 'strokes',
    gap: 'itemSpacing',
    padding: 'paddingTop', // will need all 4 for full padding
    'padding-top': 'paddingTop',
    'padding-right': 'paddingRight',
    'padding-bottom': 'paddingBottom',
    'padding-left': 'paddingLeft',
    'corner': 'cornerRadius',
    'corner-radius': 'cornerRadius',
    'font-size': 'fontSize',
    'opacity': 'opacity',
    'visible': 'visible',
    'width': 'width',
    'height': 'height',
  };
  return map[prop.toLowerCase()] || prop;
}
