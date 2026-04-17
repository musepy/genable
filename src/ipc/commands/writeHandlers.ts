/**
 * @file writeHandlers.ts
 * @description mk, rm, mv, cp command handlers — write operations on the Figma scene graph.
 *
 * Each handler is self-contained: validates args, executes, formats output.
 * Calls nodeFactory directly — no intermediate IR.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode, hasGlob, resolveGlobPaths, splitPath, normalizePath, deduplicateName, isSessionNode } from './pathResolver';
import { normalizeProps } from '../../domain/node-normalizers';
import { TAG_TO_TYPE, coerceValue, toCamelCase } from '../../engine/utils/prop-dsl';
import {
  createFrame, createText, createShape, createIcon,
  createComponent, createInstance, createComponentSet,
  cloneNode, updateNode, deleteNode, tagAsAgentCreated,
  normalizeSizingInProps, centerNodeInViewport,
  prefetchIcons, resolveParent,
  type NodeResult,
} from '../../engine/actions/nodeFactory';
import { PipelineTracer } from './pipelineTracer';

// ── Shared helpers ──

/** Wrap a run sub-command result with pipeline stages. */
function wrapRunStages(subCmd: string, result: ToolResponse, startTime: number): ToolResponse {
  const handlerStage = { label: `handle${subCmd}()`, file: 'writeHandlers.ts', durationMs: Date.now() - startTime };
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

    if (key === 'variant') { variantSelector = val; continue; }
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
  if (rawProps.h === undefined && rawProps.height === undefined) rawProps.h = 'hug';
  if (rawProps.w === undefined && rawProps.width === undefined) rawProps.w = 'hug';
}

/** Parse a raw props string like "{bg:#FFF, w:200}" into typed props. */
function parsePropString(raw: string): Record<string, any> {
  let s = raw.trim();
  if (s.startsWith('{')) s = s.slice(1);
  if (s.endsWith('}')) s = s.slice(0, -1);
  s = s.trim();
  if (!s) return {};

  const result: Record<string, any> = {};
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
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.slice(1, -1).replace(/\\(.)/g, (_, c) => c === 'n' ? '\n' : c === 't' ? '\t' : c);
  }
  result[key] = coerceValue(key, val);
}

const SHAPE_TYPES = new Set(['RECTANGLE', 'ELLIPSE', 'LINE', 'VECTOR', 'STAR', 'POLYGON']);

// ═══════════════════════════════════════════════════════════════════════════
// Direct node creation — replaces buildCreateIR + executeIR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a single node directly via nodeFactory.
 * Routes to the correct create* function based on type/ref.
 */
async function createNodeDirect(
  type: string | undefined,
  parentNode: SceneNode | null,
  rawProps: Record<string, any>,
  textContent?: string,
  refComponent?: string,
  symbolMap?: Map<string, string>,
): Promise<NodeResult & { name: string }> {
  const tag = type || 'frame';
  const figmaType = TAG_TO_TYPE[tag] || 'FRAME';
  const name = rawProps.name || tag;

  // Instance (ref component)
  if (refComponent) {
    const compRef = refComponent.includes(' ') ? toCamelCase(refComponent) : refComponent;
    const { overrides, variantSelector, ...cleanProps } = rawProps as any;
    const normalized = normalizeProps(cleanProps, {}, () => {});
    normalizeSizingInProps(normalized, null, parentNode, false);
    const result = await createInstance(compRef, parentNode, normalized,
      overrides && Object.keys(overrides).length > 0 ? overrides : undefined,
      symbolMap, variantSelector);
    return { ...result, name };
  }

  // VariantSet
  if (tag === 'variantset') {
    const fromStr = (rawProps.from as string) || '';
    const componentSymbols = fromStr.split(',').map(s => s.trim()).filter(Boolean);
    const { from: _, ...restProps } = rawProps;
    const normalized = normalizeProps(restProps, { nodeType: 'FRAME', isCreate: true }, () => {});
    normalizeSizingInProps(normalized, null, parentNode, false);
    const result = await createComponentSet(componentSymbols, parentNode, normalized, undefined, symbolMap);
    return { ...result, name };
  }

  // Icon
  if (tag === 'icon') {
    if (rawProps.size !== undefined) {
      const s = typeof rawProps.size === 'string' ? coerceValue('width', rawProps.size) : rawProps.size;
      rawProps.width = s;
      rawProps.height = s;
      delete rawProps.size;
    }
    if (rawProps.icon) { rawProps.iconName = rawProps.icon; delete rawProps.icon; }
    const normalized = normalizeProps(rawProps, {}, () => {});
    normalizeSizingInProps(normalized, null, parentNode, false);
    const result = await createIcon(parentNode, normalized);
    return { ...result, name };
  }

  // Text
  if (figmaType === 'TEXT') {
    if (textContent) rawProps.characters = textContent;
    const normalized = normalizeProps(rawProps, { nodeType: 'TEXT', isCreate: true }, () => {});
    normalizeSizingInProps(normalized, null, parentNode, true);
    const result = await createText(parentNode, normalized);
    return { ...result, name };
  }

  // Image placeholder
  if (tag === 'image') {
    const placeholder = rawProps.placeholder || rawProps.name || 'Image Placeholder';
    rawProps.fills = rawProps.fills || ['#E0E0E0'];
    rawProps.name = placeholder;
    const normalized = normalizeProps(rawProps, { nodeType: 'FRAME', isCreate: true }, () => {});
    normalizeSizingInProps(normalized, null, parentNode, false);
    const result = await createFrame(parentNode, normalized);
    return { ...result, name };
  }

  // Component
  if (tag === 'component') {
    const normalized = normalizeProps(rawProps, { nodeType: 'FRAME', isCreate: true }, () => {});
    normalizeSizingInProps(normalized, null, parentNode, false);
    const result = await createComponent(parentNode, normalized);
    return { ...result, name };
  }

  // Shape (rect, ellipse, line, vector)
  if (SHAPE_TYPES.has(figmaType)) {
    const normalized = normalizeProps(rawProps, { nodeType: figmaType, isCreate: true }, () => {});
    normalizeSizingInProps(normalized, null, parentNode, false);
    const result = await createShape(figmaType, parentNode, normalized);
    return { ...result, name };
  }

  // Frame (default)
  const normalized = normalizeProps(rawProps, { nodeType: figmaType, isCreate: true }, () => {});
  normalizeSizingInProps(normalized, null, parentNode, false);
  const result = await createFrame(parentNode, normalized);
  return { ...result, name };
}

// ═══════════════════════════════════════════════════════════════════════════
// mk
// ═══════════════════════════════════════════════════════════════════════════

async function executeSingleMk(
  path: string,
  type?: string,
  refComponent?: string,
  propTokens: string[] = [],
  textContent?: string,
): Promise<ToolResponse> {
  const { parentPath, nodeName } = splitPath(path);
  if (!nodeName) {
    return { error: 'mk requires a target name in path, e.g. mk /Card/ or mk /Card/Title' };
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
      const normalized = normalizeProps(rawProps, {}, () => {});
      normalizeSizingInProps(normalized, node as SceneNode, (node as SceneNode).parent as SceneNode | null, node.type === 'TEXT');
      await updateNode(node as SceneNode, normalized);
      return { data: { idMap: { [node.name]: node.id } } };
    }
    return { error: `Node ID "${nodeName}" not found. Use ls or grep to find the correct ID.` };
  }

  // Try to resolve the full path to check if node exists (for upsert)
  const existing = await resolvePathToNode(path);
  if (existing.ok && !existing.isPage) {
    const nodeId = existing.node.id;
    const rawProps = parseTokensToProps(propTokens);
    if (textContent) rawProps.characters = textContent;
    if (Object.keys(rawProps).length === 0) {
      return { data: { message: `Node "${nodeName}" already exists (${nodeId}). No properties to update.`, idMap: { [nodeName]: nodeId } } };
    }
    const normalized = normalizeProps(rawProps, {}, () => {});
    normalizeSizingInProps(normalized, existing.node, existing.node.parent as SceneNode | null, existing.node.type === 'TEXT');
    await updateNode(existing.node, normalized);
    return { data: { idMap: { [nodeName]: nodeId } } };
  }

  // Node doesn't exist → create mode
  const parentResolved = await resolvePathToNode(parentPath);
  if (!parentResolved.ok) return parentResolved.response;

  if (!parentResolved.isPage && !('children' in parentResolved.node)) {
    return { error: `Cannot create "${nodeName}" inside "${parentResolved.node.name}" (${parentResolved.node.type.toLowerCase()}) — it has no children. Use a frame as parent.` };
  }

  const siblings = parentResolved.isPage
    ? figma.currentPage.children
    : (parentResolved.node as FrameNode).children;
  const finalName = deduplicateName(siblings, nodeName);
  const parentNode = parentResolved.isPage ? null : parentResolved.node;

  // Build props from tokens
  let rawProps: Record<string, any>;
  if (refComponent) {
    const extracted = extractOverridesFromTokens(propTokens);
    rawProps = extracted.props;
    if (Object.keys(extracted.overrides).length > 0) (rawProps as any).overrides = extracted.overrides;
    if (extracted.variantSelector) (rawProps as any).variantSelector = extracted.variantSelector;
  } else {
    rawProps = parseTokensToProps(propTokens);
  }

  rawProps.name = finalName;
  applyLayoutDefaults(type, rawProps);

  // Center root-level nodes in viewport
  if (!parentNode) {
    const isText = (type || 'frame') === 'text';
    const centered = centerNodeInViewport(rawProps, isText);
    Object.assign(rawProps, centered);
  }

  const result = await createNodeDirect(type, parentNode, rawProps, textContent, refComponent);
  if (!result.nodeId) {
    return { error: result.warnings[0]?.message || 'Failed to create node' };
  }

  // Tag as agent-created
  try {
    const n = await figma.getNodeByIdAsync(result.nodeId) as SceneNode;
    if (n) tagAsAgentCreated(n);
  } catch { /* best-effort */ }

  const response: ToolResponse = {
    data: { idMap: { [finalName]: result.nodeId } },
  };
  if (finalName !== nodeName) {
    response.data = { ...response.data, renamed: { [nodeName]: finalName } };
  }
  return response;
}

async function executeMkBatch(batchInput: string): Promise<ToolResponse> {
  const lines = batchInput.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('//'));

  if (lines.length === 0) {
    return { error: 'No mk commands in batch input.' };
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
    return { error: 'No valid mk commands parsed from batch input.' };
  }

  // ── Sequential execution with symbol resolution ──
  const symbolMap = new Map<string, string>();    // symbol → real Figma ID
  const pathToSymbol = new Map<string, string>(); // path → latest symbol
  const idMap: Record<string, string> = {};
  const warnings: string[] = [];
  const createdNodeIds: string[] = [];
  let symbolCounter = 0;

  // Track used names per parent for batch-internal dedup
  const usedNamesPerParent = new Map<string, Set<string>>();

  async function getUsedNames(parentKey: string): Promise<Set<string>> {
    if (usedNamesPerParent.has(parentKey)) return usedNamesPerParent.get(parentKey)!;
    const names = new Set<string>();
    if (parentKey === '__page__') {
      for (const child of figma.currentPage.children) names.add(child.name);
    } else {
      const node = await figma.getNodeByIdAsync(parentKey);
      if (node && 'children' in node) {
        for (const child of (node as any).children) names.add(child.name);
      }
    }
    usedNamesPerParent.set(parentKey, names);
    return names;
  }

  // Prefetch icons
  const iconNames = parsed.filter(l => l.type === 'icon').map(l => l.nodeName);
  if (iconNames.length > 0) await prefetchIcons(iconNames);

  for (const line of parsed) {
    const sym = `n${++symbolCounter}`;

    // Resolve parent: batch-internal symbol first, then Figma tree
    let parentNode: SceneNode | null = null;
    let parentKey: string;

    const batchParentSym = pathToSymbol.get(line.parentPath);
    if (batchParentSym && symbolMap.has(batchParentSym)) {
      const parentId = symbolMap.get(batchParentSym)!;
      parentNode = await figma.getNodeByIdAsync(parentId) as SceneNode | null;
      parentKey = parentId;
    } else if (line.parentPath === '/' || line.parentPath === '') {
      parentNode = null;
      parentKey = '__page__';
    } else {
      const parentResolved = await resolvePathToNode(line.parentPath);
      if (parentResolved.ok) {
        parentNode = parentResolved.isPage ? null : parentResolved.node;
        parentKey = parentResolved.isPage ? '__page__' : parentResolved.node.id;
      } else {
        parentNode = null;
        parentKey = '__page__';
      }
    }

    pathToSymbol.set(line.path, sym);

    // Deduplicate name
    const usedNames = await getUsedNames(parentKey);
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

    // Center root-level nodes
    if (!parentNode) {
      const isText = (line.type || 'frame') === 'text';
      Object.assign(rawProps, centerNodeInViewport(rawProps, isText));
    }

    try {
      const result = await createNodeDirect(line.type, parentNode, rawProps, line.textContent, line.refComponent, symbolMap);
      if (result.nodeId) {
        symbolMap.set(sym, result.nodeId);
        idMap[displayName] = result.nodeId;
        createdNodeIds.push(result.nodeId);
        for (const w of result.warnings) warnings.push(w.message || String(w));

        // Tag as agent-created
        try {
          const n = await figma.getNodeByIdAsync(result.nodeId) as SceneNode;
          if (n) tagAsAgentCreated(n);
        } catch { /* best-effort */ }
      } else {
        for (const w of result.warnings) warnings.push(w.message || String(w));
      }
    } catch (e: any) {
      warnings.push(`Failed to create "${displayName}": ${e?.message}`);
    }
  }

  if (createdNodeIds.length === 0) {
    return { error: warnings.join('; ') || 'No nodes created.' };
  }

  return {
    data: { idMap, created: createdNodeIds.length },
  };
}

export async function handleMk(parameters: any): Promise<ToolResponse> {
  const _t0 = Date.now();
  const { batch, path: mkPath, type: mkType, refComponent, propTokens, textContent } = parameters;

  if (batch) {
    return wrapRunStages('Mk', await executeMkBatch(batch), _t0);
  }

  if (!mkPath) {
    return { error: 'mk requires a path. Usage: mk /Card/ frame w:400 layout:column' };
  }

  // Guard: detect embedded batch commands in propTokens
  if (propTokens && Array.isArray(propTokens) && propTokens.some((t: string) => /\nmk\s|^mk\s/.test(t))) {
    const reconstructed = `${mkPath}${mkType ? ' ' + mkType : ''} ${(propTokens || []).join(' ')}${textContent ? ' -- ' + textContent : ''}`;
    return wrapRunStages('Mk', await executeMkBatch(reconstructed), _t0);
  }

  const result = await executeSingleMk(mkPath, mkType, refComponent, propTokens || [], textContent);
  return wrapRunStages('Mk', result, _t0);
}

// ═══════════════════════════════════════════════════════════════════════════
// rm
// ═══════════════════════════════════════════════════════════════════════════

export async function handleRm(parameters: any): Promise<ToolResponse> {
  const _t0 = Date.now();
  const rmPath = parameters.path || '/';

  // Glob support
  if (hasGlob(rmPath)) {
    const globNodes = await resolveGlobPaths(rmPath);
    if (globNodes.length === 0) {
      return { error: `No nodes matched pattern "${rmPath}". Use ls to check available children.` };
    }
    let deleted = 0;
    for (const n of globNodes) {
      deleteNode(n);
      deleted++;
    }
    return wrapRunStages('Rm', {
      data: { deleted },
    }, _t0);
  }

  const rmResolved = await resolvePathToNode(rmPath);
  if (!rmResolved.ok) return rmResolved.response;
  if (rmResolved.isPage) {
    return { error: 'Cannot delete page root. Target a specific node, e.g. rm /Card/' };
  }

  const rmNodeName = rmResolved.node.name;
  const rmNodeId = rmResolved.node.id;
  const rmIsSessionNode = isSessionNode(rmNodeId) || rmResolved.node.getPluginData('_agent') === 'created';

  deleteNode(rmResolved.node);

  const response: ToolResponse = {
    data: { deleted: rmNodeName, id: rmNodeId },
  };

  if (!rmIsSessionNode) {
    response.data = { ...response.data, warning: `⚠ "${rmNodeName}" was not created by you in this session.` };
  }

  return wrapRunStages('Rm', response, _t0);
}

// ═══════════════════════════════════════════════════════════════════════════
// mv (already direct Figma API — no changes needed)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMv(parameters: any): Promise<ToolResponse> {
  const _t0 = Date.now();
  const { sourcePath: mvSourcePath, destPath: mvDestPath, at: mvAtIndex } = parameters;

  if (!mvSourcePath) {
    return { error: 'mv requires a source path. Usage: mv /OldName /NewName' };
  }
  if (!mvDestPath) {
    return { error: 'mv requires a destination path. Usage: mv /OldName /NewName' };
  }

  const mvSourceResolved = await resolvePathToNode(mvSourcePath);
  if (!mvSourceResolved.ok) return mvSourceResolved.response;
  if (mvSourceResolved.isPage) {
    return { error: 'Cannot move page root.' };
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
      return { error: 'Destination must include a name, e.g. mv /Card/OldTitle /Card/NewTitle' };
    }
    mvNewName = mvTargetName;

    const mvParentResolved = await resolvePathToNode(mvParentPath);
    if (!mvParentResolved.ok) return mvParentResolved.response;

    if (mvParentResolved.isPage) {
      mvNewParent = figma.currentPage;
    } else if ('children' in mvParentResolved.node) {
      mvNewParent = mvParentResolved.node as BaseNode & ChildrenMixin;
    } else {
      return { error: `"${mvParentPath}" is not a container. Cannot move node there.` };
    }
  }

  const mvRenamed = mvOldName !== mvNewName;
  if (mvRenamed) mvNode.name = mvNewName;

  const mvMoved = mvNewParent != null && mvNewParent.id !== mvOldParentId;
  let mvReordered = false;

  if (mvMoved) {
    if (mvAtIndex != null) {
      const idx = mvAtIndex < 0 ? (mvNewParent as any).children.length : mvAtIndex;
      (mvNewParent as any).insertChild(idx, mvNode);
    } else {
      (mvNewParent as any).appendChild(mvNode);
    }
  } else if (mvAtIndex != null && mvNewParent != null) {
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

// ═══════════════════════════════════════════════════════════════════════════
// cp
// ═══════════════════════════════════════════════════════════════════════════

export async function handleCp(parameters: {
  sourceId: string;
  parentId?: string;
  cloneName: string;
  propsRaw?: string;
}): Promise<ToolResponse> {
  const _t0 = Date.now();
  const { sourceId: cpSourceId, parentId: cpParentId, cloneName: cpCloneName, propsRaw: cpPropsRaw } = parameters;

  if (!cpSourceId) {
    return { error: 'cp requires a sourceId.' };
  }
  if (!cpCloneName) {
    return { error: 'cp requires a cloneName.' };
  }

  // Resolve parent node (null = page root)
  let cpParentNode: SceneNode | null = null;
  if (cpParentId) {
    const parentNode = await figma.getNodeByIdAsync(cpParentId);
    if (!parentNode) {
      return { error: `Parent node not found: ${cpParentId}` };
    }
    if (parentNode.type === 'PAGE' || parentNode.type === 'DOCUMENT') {
      return { error: `Parent node "${cpParentId}" cannot contain children.` };
    }
    cpParentNode = parentNode as SceneNode;
  }

  // Parse raw props string
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

  // Normalize overrides
  const normOverrides: Record<string, Record<string, any>> = {};
  for (const [childName, childProps] of Object.entries(overrides)) {
    normOverrides[childName] = normalizeProps(childProps, {}, () => {});
  }

  const normalizedRoot = normalizeProps(rootProps, { nodeType: 'FRAME', isCreate: true }, () => {});
  const result = await cloneNode(
    cpSourceId,
    cpParentNode,
    normalizedRoot,
    Object.keys(normOverrides).length > 0 ? normOverrides : undefined,
  );

  if (!result.nodeId) {
    return { error: result.warnings[0]?.message || 'Clone failed' };
  }

  // Tag as agent-created
  try {
    const n = await figma.getNodeByIdAsync(result.nodeId) as SceneNode;
    if (n) tagAsAgentCreated(n);
  } catch { /* best-effort */ }

  const cpResult: ToolResponse = {
    data: {
      idMap: { [cpCloneName]: result.nodeId },
      // Expose all descendant IDs so the inspection tracker registers them.
      // Without this, subsequent edits on cloned children hit the "unknown" gate.
      createdIds: result.createdIds ?? [result.nodeId],
    },
  };
  return wrapRunStages('Cp', cpResult, _t0);
}
