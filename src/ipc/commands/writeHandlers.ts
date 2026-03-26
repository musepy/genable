/**
 * @file writeHandlers.ts
 * @description mk, rm, mv, cp command handlers — write operations on the Figma scene graph.
 *
 * Each handler is self-contained: validates args, executes, formats output.
 * Constructs OperationIR[] directly — no string round-trip through flat ops.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import type { OperationIR } from '../../domain/design-ir';
import { resolvePathToNode, hasGlob, resolveGlobPaths, splitPath, normalizePath, deduplicateName, isSessionNode } from './pathResolver';
import { executeIR } from './shared';
import { normalizeProps } from '../../domain/node-normalizers';
import { TAG_TO_TYPE, coerceValue, toCamelCase, computeDependsOn } from '../../engine/utils/prop-dsl';
import { PipelineTracer } from './pipelineTracer';

// ── Shared helpers ──

/** Wrap a run sub-command result with pipeline stages. */
function wrapRunStages(subCmd: string, result: ToolResponse, startTime: number): ToolResponse {
  const handlerStage = { label: `handle${subCmd}() → IR`, file: 'writeHandlers.ts', durationMs: Date.now() - startTime };
  // Prepend handler stage before executor/receipt stages from executeIR
  const existing = (result as any)._stages || [];
  (result as any)._stages = [
    { label: 'unwrapRunCmd()', file: 'toolDispatcher.ts', durationMs: 0 },
    handlerStage,
    ...existing,
  ];
  return result;
}

/** Parse "key:value" string tokens into a typed props object. */
function parseTokensToProps(tokens: string[]): Record<string, any> {
  const props: Record<string, any> = {};
  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx < 0) continue;
    const key = token.slice(0, colonIdx);
    const val = token.slice(colonIdx + 1);
    props[key] = coerceValue(key, val);
  }
  return props;
}

/**
 * Extract set: overrides and variant selector from prop tokens.
 * Returns separated props, overrides, and variantSelector.
 */
function extractOverridesFromTokens(tokens: string[]): {
  props: Record<string, any>;
  overrides: Record<string, Record<string, any>>;
  variantSelector?: string;
} {
  const props: Record<string, any> = {};
  const overrides: Record<string, Record<string, any>> = {};
  let variantSelector: string | undefined;

  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx < 0) continue;
    const key = token.slice(0, colonIdx);
    const val = token.slice(colonIdx + 1);

    if (key === 'variant') {
      variantSelector = val;
      continue;
    }
    if (key === 'set') {
      const secondColon = val.indexOf(':');
      if (secondColon >= 0) {
        const childName = val.slice(0, secondColon);
        const text = val.slice(secondColon + 1);
        overrides[childName] = { characters: text };
      }
      continue;
    }
    props[key] = coerceValue(key, val);
  }

  return { props, overrides, variantSelector };
}

/** Apply layout defaults: frames with layout default to hug if no explicit size. */
function applyLayoutDefaults(type: string | undefined, rawProps: Record<string, any>): void {
  const effectiveType = type || 'frame';
  if (effectiveType !== 'frame' && effectiveType !== 'section' && effectiveType !== 'component') return;
  const hasLayout = rawProps.layout !== undefined || rawProps.layoutMode !== undefined;
  if (!hasLayout) return;
  if (rawProps.h === undefined && rawProps.height === undefined && rawProps.sizingV === undefined) rawProps.h = 'hug';
  if (rawProps.w === undefined && rawProps.width === undefined && rawProps.sizingH === undefined) rawProps.w = 'hug';
}

/** Parse a raw props string like "{bg:#FFF, w:200}" into typed props. */
function parsePropString(raw: string): Record<string, any> {
  let s = raw.trim();
  if (s.startsWith('{')) s = s.slice(1);
  if (s.endsWith('}')) s = s.slice(0, -1);
  s = s.trim();
  if (!s) return {};

  const result: Record<string, any> = {};
  // Split on commas, respecting quotes
  let cur = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '\\' && i + 1 < s.length) { cur += c + s[++i]; continue; }
      if (c === "'") { inQ = false; cur += c; continue; }
      cur += c;
      continue;
    }
    if (c === "'") { inQ = true; cur += c; continue; }
    if (c === ',') {
      processEntry(cur.trim(), result);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) processEntry(cur.trim(), result);
  return result;
}

function processEntry(entry: string, result: Record<string, any>): void {
  if (!entry) return;
  const colonIdx = entry.indexOf(':');
  if (colonIdx < 0) return;
  const key = entry.slice(0, colonIdx).trim();
  let val = entry.slice(colonIdx + 1).trim();
  // Strip surrounding quotes
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.slice(1, -1).replace(/\\(.)/g, (_, c) => c === 'n' ? '\n' : c === 't' ? '\t' : c);
  }
  result[key] = coerceValue(key, val);
}

/** Build a create OperationIR for a given type, props, and parent. */
function buildCreateIR(
  symbol: string,
  parentRef: string,
  type: string | undefined,
  rawProps: Record<string, any>,
  textContent?: string,
  refComponent?: string,
): OperationIR {
  const tag = type || 'frame';
  const figmaType = TAG_TO_TYPE[tag] || 'FRAME';
  const deps = computeDependsOn(parentRef);

  // Instance (ref component)
  if (refComponent) {
    const compRef = refComponent.includes(' ') ? toCamelCase(refComponent) : refComponent;
    const { overrides, variantSelector, ...cleanProps } = rawProps as any;
    const compDeps = [...deps];
    if (compRef && !compRef.includes(':')) compDeps.push(compRef);
    return {
      command: 'instance',
      symbol,
      parentRef,
      componentRef: compRef,
      props: normalizeProps(cleanProps, {}, () => {}),
      dependsOn: compDeps,
      ...(overrides && Object.keys(overrides).length > 0 ? { overrides } : {}),
      ...(variantSelector ? { variantSelector } : {}),
    };
  }

  // VariantSet
  if (tag === 'variantset') {
    const fromStr = (rawProps.from as string) || '';
    const componentSymbols = fromStr.split(',').map(s => s.trim()).filter(Boolean);
    const { from: _, ...restProps } = rawProps;
    return {
      command: 'variantSet',
      symbol,
      parentRef,
      props: normalizeProps(restProps, { nodeType: 'FRAME', isCreate: true }, () => {}),
      dependsOn: [...deps, ...componentSymbols],
      variantComponents: componentSymbols,
    };
  }

  // Icon
  if (tag === 'icon') {
    if (rawProps.size !== undefined) {
      const s = typeof rawProps.size === 'string' ? coerceValue('width', rawProps.size) : rawProps.size;
      rawProps.width = s;
      rawProps.height = s;
      delete rawProps.size;
    }
    if (rawProps.icon) {
      rawProps.iconName = rawProps.icon;
      delete rawProps.icon;
    }
    return {
      command: 'icon',
      symbol,
      parentRef,
      props: normalizeProps(rawProps, {}, () => {}),
      dependsOn: deps,
    };
  }

  // Text / Container / Shape / Image
  if (textContent && figmaType === 'TEXT') rawProps.characters = textContent;
  const isImage = tag === 'image';
  const isComponent = tag === 'component';

  return {
    command: isImage ? 'image' : 'create',
    nodeType: figmaType,
    symbol,
    parentRef,
    props: normalizeProps(rawProps, { nodeType: figmaType, isCreate: true }, () => {}),
    dependsOn: deps,
    ...(isComponent ? { reusable: true } : {}),
  };
}

// ── mk ──

async function executeSingleMk(
  path: string,
  type?: string,
  refComponent?: string,
  propTokens: string[] = [],
  textContent?: string,
): Promise<ToolResponse> {
  const { parentPath, nodeName } = splitPath(path);
  if (!nodeName) {
    return { error: { code: 'INVALID_PATH', message: 'mk requires a target name in path, e.g. mk /Card/ or mk /Card/Title' } };
  }

  // ID-based path: if nodeName is a bare Figma ID (digits:digits), resolve and update directly
  if (/^\d+:\d+$/.test(nodeName)) {
    const node = await figma.getNodeByIdAsync(nodeName);
    if (node && 'visible' in node) {
      const rawProps = parseTokensToProps(propTokens);
      if (textContent) rawProps.characters = textContent;
      if (Object.keys(rawProps).length === 0) {
        return { data: { message: `Node "${node.name}" (${node.id}) — no properties to update.`, idMap: {} } };
      }
      return executeIR([{
        command: 'update',
        targetRef: node.id,
        props: normalizeProps(rawProps, {}, () => {}),
        dependsOn: [],
      }]);
    }
    return { error: { code: 'NODE_NOT_FOUND', message: `Node ID "${nodeName}" not found. Use ls or grep to find the correct ID.` } };
  }

  // Try to resolve the full path to check if node exists (for upsert)
  const existing = await resolvePathToNode(path);
  if (existing.ok && !existing.isPage) {
    // Path resolves to an existing node — UPDATE (upsert)
    const nodeId = existing.node.id;
    const rawProps = parseTokensToProps(propTokens);
    if (textContent) {
      rawProps.characters = textContent;
    }
    if (Object.keys(rawProps).length === 0) {
      return { data: { message: `Node "${nodeName}" already exists (${nodeId}). No properties to update.`, idMap: { [nodeName]: nodeId } } };
    }
    const result = await executeIR([{
      command: 'update',
      targetRef: nodeId,
      props: normalizeProps(rawProps, {}, () => {}),
      dependsOn: [],
    }]);
    // Include the edited node ID so callers can reference it (updates produce empty idMap)
    if (!result.error && result.data) {
      result.data.idMap = { ...result.data.idMap, [nodeName]: nodeId };
    }
    return result;
  }

  // Node doesn't exist (or page-level collision) → create mode
  const parentResolved = await resolvePathToNode(parentPath);
  if (!parentResolved.ok) return parentResolved.response;

  // Guard: parent must be a container (frame/group/component/page), not text/rect/etc.
  if (!parentResolved.isPage && !('children' in parentResolved.node)) {
    return { error: { code: 'NOT_A_CONTAINER', message: `Cannot create "${nodeName}" inside "${parentResolved.node.name}" (${parentResolved.node.type.toLowerCase()}) — it has no children. Use a frame as parent.` } };
  }

  // Deduplicate name among siblings — like Unix, names are unique within a directory
  const siblings = parentResolved.isPage
    ? figma.currentPage.children
    : (parentResolved.node as FrameNode).children;
  let finalName = deduplicateName(siblings, nodeName);

  const parentId = parentResolved.isPage ? undefined : parentResolved.node.id;

  // Build props from tokens
  let rawProps: Record<string, any>;
  let overrides: Record<string, Record<string, any>> | undefined;
  let variantSelector: string | undefined;

  if (refComponent) {
    const extracted = extractOverridesFromTokens(propTokens);
    rawProps = extracted.props;
    overrides = Object.keys(extracted.overrides).length > 0 ? extracted.overrides : undefined;
    variantSelector = extracted.variantSelector;
  } else {
    rawProps = parseTokensToProps(propTokens);
  }

  rawProps.name = finalName;
  applyLayoutDefaults(type, rawProps);

  // Attach overrides/variant to props for buildCreateIR to extract
  if (overrides) (rawProps as any).overrides = overrides;
  if (variantSelector) (rawProps as any).variantSelector = variantSelector;

  const op = buildCreateIR('n1', 'root', type, rawProps, textContent, refComponent);

  const response = await executeIR([op], { parentId });
  if (finalName !== nodeName && !response.error) {
    response.data = { ...response.data, renamed: { [nodeName]: finalName } };
  }
  return response;
}

async function executeMkBatch(batchInput: string): Promise<ToolResponse> {
  const lines = batchInput.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('//'));

  if (lines.length === 0) {
    return { error: { code: 'EMPTY_BATCH', message: 'No mk commands in batch input.' } };
  }

  const MK_TYPES = new Set(['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'group', 'section', 'vector', 'component', 'variantset']);

  interface MkLine {
    path: string;
    parentPath: string;
    nodeName: string;
    type?: string;
    refComponent?: string;
    propTokens: string[];
    textContent?: string;
  }

  const parsed: MkLine[] = [];
  for (const line of lines) {
    const stripped = line.startsWith('mk ') ? line.slice(3).trim() : line;

    const tokens: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < stripped.length; i++) {
      const ch = stripped[i];
      if (inQ) {
        if (ch === "'") { inQ = false; } else { cur += ch; }
      } else if (ch === "'") {
        inQ = true;
      } else if (ch === ' ' || ch === '\t') {
        if (cur) { tokens.push(cur); cur = ''; }
      } else {
        cur += ch;
      }
    }
    if (cur) tokens.push(cur);

    if (tokens.length === 0) continue;

    // Reconstruct path from initial tokens (handles spaces in names like "/Pricing Table/")
    // Path starts with '/' and continues until we hit a type keyword, property (:), '--', or ref
    let path = tokens[0];
    let pathEnd = 1;
    if (path.startsWith('/')) {
      while (pathEnd < tokens.length) {
        const next = tokens[pathEnd];
        if (MK_TYPES.has(next) || next.includes(':') || next === '--' || next === 'ref' || next.startsWith('ref:')) break;
        path += ' ' + next;
        pathEnd++;
      }
    }

    let type: string | undefined;
    let refComponent: string | undefined;
    let propsStart = pathEnd;

    if (tokens[pathEnd]) {
      if (MK_TYPES.has(tokens[pathEnd])) { type = tokens[pathEnd]; propsStart = pathEnd + 1; }
      else if (tokens[pathEnd].startsWith('ref:')) { refComponent = tokens[pathEnd].slice(4); propsStart = pathEnd + 1; }
      else if (tokens[pathEnd] === 'ref' && tokens[pathEnd + 1]) { refComponent = tokens[pathEnd + 1]; propsStart = pathEnd + 2; }
    }

    const propTokens: string[] = [];
    const textParts: string[] = [];
    let hitSep = false;
    for (let i = propsStart; i < tokens.length; i++) {
      if (tokens[i] === '--') { hitSep = true; continue; }
      if (hitSep) { textParts.push(tokens[i]); }
      else if (tokens[i].includes(':')) { propTokens.push(tokens[i]); }
      else { textParts.push(tokens[i]); }
    }

    const { parentPath, nodeName } = splitPath(path);
    if (!nodeName) continue;

    parsed.push({
      path: normalizePath(path), parentPath: normalizePath(parentPath), nodeName, type, refComponent, propTokens,
      textContent: textParts.length > 0 ? textParts.join(' ') : undefined,
    });
  }

  if (parsed.length === 0) {
    return { error: { code: 'PARSE_ERROR', message: 'No valid mk commands parsed from batch input.' } };
  }

  // ── Sequential symbol resolution ──
  const latestSymbolForPath = new Map<string, string>();
  let symbolCounter = 0;

  // Track used names per parent for batch-internal dedup (Unix: unique names within dir)
  const usedNamesPerParent = new Map<string, Set<string>>();

  /** Get or initialize the used-names set for a parent, seeding from existing Figma children. */
  async function getUsedNames(parentRef: string): Promise<Set<string>> {
    if (usedNamesPerParent.has(parentRef)) return usedNamesPerParent.get(parentRef)!;
    const names = new Set<string>();
    if (parentRef === 'root') {
      for (const child of figma.currentPage.children) names.add(child.name);
    } else if (parentRef.startsWith("'")) {
      const node = await figma.getNodeByIdAsync(parentRef.replace(/'/g, ''));
      if (node && 'children' in node) {
        for (const child of (node as any).children) names.add(child.name);
      }
    }
    // Batch-internal parents (symbols like n1) start empty — no existing Figma children
    usedNamesPerParent.set(parentRef, names);
    return names;
  }

  // Generate OperationIR[] directly
  const ops: OperationIR[] = [];

  for (const line of parsed) {
    // Resolve parent: batch-internal symbol first, then Figma tree
    let parentRef: string;
    if (latestSymbolForPath.has(line.parentPath)) {
      parentRef = latestSymbolForPath.get(line.parentPath)!;
    } else if (line.parentPath === '/' || line.parentPath === '') {
      parentRef = 'root';
    } else {
      const parentResolved = await resolvePathToNode(line.parentPath);
      if (parentResolved.ok) {
        parentRef = parentResolved.isPage ? 'root' : `'${parentResolved.node.id}'`;
      } else {
        parentRef = 'root';
      }
    }

    // Always create a new symbol (never reuse — each line = new node)
    const sym = `n${++symbolCounter}`;
    latestSymbolForPath.set(line.path, sym); // Overwrite: children use latest parent

    // Deduplicate name among siblings — Unix-style unique names within parent
    const usedNames = await getUsedNames(parentRef);
    let displayName = line.nodeName;
    if (usedNames.has(displayName)) {
      let i = 2;
      while (usedNames.has(`${displayName}_${i}`)) i++;
      displayName = `${displayName}_${i}`;
    }
    usedNames.add(displayName);

    // Build props
    let rawProps: Record<string, any>;
    if (line.refComponent) {
      const extracted = extractOverridesFromTokens(line.propTokens);
      rawProps = extracted.props;
      if (Object.keys(extracted.overrides).length > 0) (rawProps as any).overrides = extracted.overrides;
      if (extracted.variantSelector) (rawProps as any).variantSelector = extracted.variantSelector;
    } else {
      rawProps = parseTokensToProps(line.propTokens);
    }
    rawProps.name = displayName;
    applyLayoutDefaults(line.type, rawProps);

    ops.push(buildCreateIR(sym, parentRef, line.type, rawProps, line.textContent, line.refComponent));
  }

  if (ops.length === 0) {
    return { data: { message: 'All nodes already exist. No changes needed.' } };
  }

  return await executeIR(ops);
}

export async function handleMk(parameters: any): Promise<ToolResponse> {
  const _t0 = Date.now();
  const { batch, path: mkPath, type: mkType, refComponent, propTokens, textContent } = parameters;

  if (batch) {
    return wrapRunStages('Mk', await executeMkBatch(batch), _t0);
  }

  if (!mkPath) {
    return { error: { code: 'INVALID_PATH', message: 'mk requires a path. Usage: mk /Card/ frame w:400 layout:column' } };
  }

  // Guard: detect embedded batch commands in propTokens
  if (propTokens && Array.isArray(propTokens) && propTokens.some((t: string) => /\nmk\s|^mk\s/.test(t))) {
    const reconstructed = `${mkPath}${mkType ? ' ' + mkType : ''} ${(propTokens || []).join(' ')}${textContent ? ' -- ' + textContent : ''}`;
    return wrapRunStages('Mk', await executeMkBatch(reconstructed), _t0);
  }

  const result = await executeSingleMk(mkPath, mkType, refComponent, propTokens || [], textContent);
  return wrapRunStages('Mk', result, _t0);
}

// ── rm ──

export async function handleRm(parameters: any): Promise<ToolResponse> {
  const _t0 = Date.now();
  const rmPath = parameters.path || '/';

  // Glob support
  if (hasGlob(rmPath)) {
    const globNodes = await resolveGlobPaths(rmPath);
    if (globNodes.length === 0) {
      return { error: { code: 'NO_MATCH', message: `No nodes matched pattern "${rmPath}". Use ls to check available children.` } };
    }
    const ops: OperationIR[] = globNodes.map(n => ({
      command: 'delete' as const,
      targetRef: n.id,
      props: {},
      dependsOn: [],
    }));
    return await executeIR(ops);
  }

  const rmResolved = await resolvePathToNode(rmPath);
  if (!rmResolved.ok) return rmResolved.response;
  if (rmResolved.isPage) {
    return { error: { code: 'INVALID_TARGET', message: 'Cannot delete page root. Target a specific node, e.g. rm /Card/' } };
  }

  // Capture metadata before deletion (node becomes inaccessible after remove)
  const rmNodeName = rmResolved.node.name;
  const rmNodeId = rmResolved.node.id;
  const rmIsSessionNode = isSessionNode(rmNodeId) || rmResolved.node.getPluginData('_agent') === 'created';

  const rmResult = await executeIR([{
    command: 'delete',
    targetRef: rmNodeId,
    props: {},
    dependsOn: [],
  }]);

  // Warn if deleting a node not created by this session
  if (!rmResult.error && !rmIsSessionNode) {
    rmResult.data = {
      ...rmResult.data,
      warning: `⚠ "${rmNodeName}" was not created by you in this session.`,
    };
  }

  return wrapRunStages('Rm', rmResult, _t0);
}

// ── mv ──

export async function handleMv(parameters: any): Promise<ToolResponse> {
  const _t0 = Date.now();
  const { sourcePath: mvSourcePath, destPath: mvDestPath, at: mvAtIndex } = parameters;

  if (!mvSourcePath) {
    return { error: { code: 'MISSING_SOURCE', message: 'mv requires a source path. Usage: mv /OldName /NewName' } };
  }
  if (!mvDestPath) {
    return { error: { code: 'MISSING_DEST', message: 'mv requires a destination path. Usage: mv /OldName /NewName' } };
  }

  const mvSourceResolved = await resolvePathToNode(mvSourcePath);
  if (!mvSourceResolved.ok) return mvSourceResolved.response;
  if (mvSourceResolved.isPage) {
    return { error: { code: 'INVALID_SOURCE', message: 'Cannot move page root.' } };
  }
  const mvNode = mvSourceResolved.node;
  const mvOldName = mvNode.name;
  const mvOldParentId = mvNode.parent?.id;

  let mvNewName: string = mvNode.name;
  let mvNewParent: (BaseNode & ChildrenMixin) | null = null;

  const mvDestResolved = await resolvePathToNode(mvDestPath);
  if (mvDestResolved.ok && !mvDestResolved.isPage && 'children' in mvDestResolved.node) {
    mvNewParent = mvDestResolved.node as BaseNode & ChildrenMixin;
  } else if (mvDestResolved.ok && mvDestResolved.isPage) {
    mvNewParent = figma.currentPage;
  } else {
    const { parentPath: mvParentPath, nodeName: mvTargetName } = splitPath(mvDestPath);
    if (!mvTargetName) {
      return { error: { code: 'INVALID_DEST', message: 'Destination must include a name, e.g. mv /Card/OldTitle /Card/NewTitle' } };
    }
    mvNewName = mvTargetName;

    const mvParentResolved = await resolvePathToNode(mvParentPath);
    if (!mvParentResolved.ok) return mvParentResolved.response;

    if (mvParentResolved.isPage) {
      mvNewParent = figma.currentPage;
    } else if ('children' in mvParentResolved.node) {
      mvNewParent = mvParentResolved.node as BaseNode & ChildrenMixin;
    } else {
      return { error: { code: 'INVALID_DEST', message: `"${mvParentPath}" is not a container. Cannot move node there.` } };
    }
  }

  const mvRenamed = mvOldName !== mvNewName;
  if (mvRenamed) mvNode.name = mvNewName;

  const mvMoved = mvNewParent != null && mvNewParent.id !== mvOldParentId;
  let mvReordered = false;

  if (mvMoved) {
    // Moving to a different parent
    if (mvAtIndex != null) {
      const idx = mvAtIndex < 0 ? (mvNewParent as any).children.length : mvAtIndex;
      (mvNewParent as any).insertChild(idx, mvNode);
    } else {
      (mvNewParent as any).appendChild(mvNode);
    }
  } else if (mvAtIndex != null && mvNewParent != null) {
    // Same parent — reorder using insertChild
    const parent = mvNewParent as any;
    const childCount = parent.children.length;
    const idx = mvAtIndex < 0 ? childCount - 1 : Math.min(mvAtIndex, childCount - 1);
    parent.insertChild(idx, mvNode);
    mvReordered = true;
  }

  const mvResult: ToolResponse = {
    data: {
      id: mvNode.id,
      oldName: mvOldName,
      newName: mvNewName,
      renamed: mvRenamed,
      moved: mvMoved,
      reordered: mvReordered,
      newParent: mvMoved ? mvNewParent!.name : undefined,
      index: mvReordered ? mvAtIndex : undefined,
    },
  };
  return wrapRunStages('Mv', mvResult, _t0);
}

// ── cp ──

export async function handleCp(parameters: any): Promise<ToolResponse> {
  const _t0 = Date.now();
  const { sourcePath: cpSourcePath, destPath: cpDestPath, propsRaw: cpPropsRaw } = parameters;

  if (!cpSourcePath) {
    return { error: { code: 'MISSING_SOURCE', message: 'cp requires a source path. Usage: cp /Source/ /Dest/ {overrides}' } };
  }
  if (!cpDestPath) {
    return { error: { code: 'MISSING_DEST', message: 'cp requires a destination path. Usage: cp /Source/ /Dest/ {overrides}' } };
  }

  const cpSourceResolved = await resolvePathToNode(cpSourcePath);
  if (!cpSourceResolved.ok) return cpSourceResolved.response;
  if (cpSourceResolved.isPage) {
    return { error: { code: 'INVALID_SOURCE', message: 'Cannot clone page root.' } };
  }
  const cpSourceId = cpSourceResolved.node.id;

  const { parentPath: cpParentPath, nodeName: cpCloneName } = splitPath(cpDestPath);
  if (!cpCloneName) {
    return { error: { code: 'INVALID_PATH', message: 'Destination path must include a name, e.g. /Card/Hover/' } };
  }

  const cpParentResolved = await resolvePathToNode(cpParentPath);
  if (!cpParentResolved.ok) return cpParentResolved.response;

  const cpParentId = cpParentResolved.isPage ? undefined : cpParentResolved.node.id;

  // Parse raw props string (from CLI: "{bg:#FFF, w:200}")
  const rawProps = parsePropString(cpPropsRaw || '');
  rawProps.name = cpCloneName;

  // Separate dot-notation keys (child overrides) from root props
  const rootProps: Record<string, any> = {};
  const overrides: Record<string, Record<string, any>> = {};
  for (const [k, v] of Object.entries(rawProps)) {
    const dotIdx = k.indexOf('.');
    if (dotIdx > 0) {
      const childName = k.substring(0, dotIdx);
      const childProp = k.substring(dotIdx + 1);
      if (!overrides[childName]) overrides[childName] = {};
      overrides[childName][childProp] = v;
    } else {
      rootProps[k] = v;
    }
  }

  // Normalize child overrides
  const normOverrides: Record<string, Record<string, any>> = {};
  for (const [childName, childProps] of Object.entries(overrides)) {
    normOverrides[childName] = normalizeProps(childProps, {}, () => {});
  }

  const cpResult = await executeIR([{
    command: 'clone',
    symbol: 'n1',
    parentRef: 'root',
    sourceRef: cpSourceId,
    props: normalizeProps(rootProps, { nodeType: 'FRAME', isCreate: true }, () => {}),
    dependsOn: [],
    ...(Object.keys(normOverrides).length > 0 ? { overrides: normOverrides } : {}),
  }], { parentId: cpParentId });
  return wrapRunStages('Cp', cpResult, _t0);
}
