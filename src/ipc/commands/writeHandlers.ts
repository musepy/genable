/**
 * @file writeHandlers.ts
 * @description mk, rm, mv, cp command handlers — write operations on the Figma scene graph.
 *
 * Each handler is self-contained: validates args, executes, formats output.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode, hasGlob, resolveGlobPaths, splitPath, normalizePath, deduplicateName } from './pathResolver';
import {
  executeFlatOps, escapeFlatOpsStr, injectNameProp, injectLayoutDefaults,
  mkPropToFlatOps, stripBraces,
} from './shared';

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
    return { success: false, error: { code: 'INVALID_PATH', message: 'mk requires a target name in path, e.g. mk /Card/ or mk /Card/Title' } };
  }

  // ID-based path: if nodeName looks like a Figma ID (contains ':'), resolve and update directly
  if (nodeName.includes(':')) {
    const node = await figma.getNodeByIdAsync(nodeName);
    if (node && 'visible' in node) {
      const nodeId = node.id;
      const propsBlock = propTokens.map(mkPropToFlatOps).join(', ');
      if (!propsBlock && !textContent) {
        return { success: true, data: { message: `Node "${node.name}" (${nodeId}) — no properties to update.`, idMap: {} } };
      }
      let ops = textContent
        ? `update('${nodeId}', {${propsBlock ? propsBlock + ', ' : ''}characters:'${escapeFlatOpsStr(textContent)}'})`
        : `update('${nodeId}', {${propsBlock}})`;
      return await executeFlatOps(ops);
    }
    return { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ID "${nodeName}" not found. Use ls or grep to find the correct ID.` } };
  }

  // Try to resolve the full path to check if node exists (for upsert)
  const existing = await resolvePathToNode(path);
  if (existing.ok && !existing.isPage) {
    // Page-level collision: skip upsert, create new with deduplicated name
    const isPageLevel = parentPath === '/' || parentPath === '';
    if (!isPageLevel) {
      // Nested node — upsert as before
      const nodeId = existing.node.id;
      const propsBlock = propTokens.map(mkPropToFlatOps).join(', ');
      if (!propsBlock && !textContent) {
        return { success: true, data: { message: `Node "${nodeName}" already exists (${nodeId}). No properties to update.`, idMap: { [nodeName]: nodeId } } };
      }
      let ops = `update('${nodeId}', {${propsBlock}})`;
      if (textContent) {
        const escaped = escapeFlatOpsStr(textContent);
        ops = `update('${nodeId}', {${propsBlock ? propsBlock + ', ' : ''}characters:'${escaped}'})`;
      }
      return await executeFlatOps(ops);
    }
    // Page-level: fall through to create mode with deduplication
  }

  // Node doesn't exist (or page-level collision) → create mode
  const parentResolved = await resolvePathToNode(parentPath);
  if (!parentResolved.ok) return parentResolved.response;

  // Guard: parent must be a container (frame/group/component/page), not text/rect/etc.
  if (!parentResolved.isPage && !('children' in parentResolved.node)) {
    return { success: false, error: { code: 'NOT_A_CONTAINER', message: `Cannot create "${nodeName}" inside "${parentResolved.node.name}" (${parentResolved.node.type.toLowerCase()}) — it has no children. Use a frame as parent.` } };
  }

  // Deduplicate name for page-level nodes to avoid collision with existing designs
  let finalName = nodeName;
  if (parentResolved.isPage) {
    finalName = deduplicateName(figma.currentPage.children, nodeName);
  }

  const parentId = parentResolved.isPage ? undefined : parentResolved.node.id;
  const adjustedTokens = injectLayoutDefaults(type, propTokens);
  const propsInner = adjustedTokens.map(mkPropToFlatOps).join(', ');
  const propsWithName = injectNameProp(propsInner, finalName);

  let ops: string;
  if (type === 'variantset') {
    ops = `n1 = variantSet(root, {${propsWithName}})`;
  } else if (refComponent) {
    const escapedComp = escapeFlatOpsStr(refComponent);
    ops = `n1 = ref('${escapedComp}', root, {${propsWithName}})`;
  } else if (type === 'text' || textContent) {
    const nodeType = type || 'text';
    const textArg = textContent ? `, '${escapeFlatOpsStr(textContent)}'` : '';
    ops = `n1 = ${nodeType}(root, {${propsWithName}}${textArg})`;
  } else {
    const nodeType = type || 'frame';
    ops = `n1 = ${nodeType}(root, {${propsWithName}})`;
  }

  const response = await executeFlatOps(ops, parentId);
  if (finalName !== nodeName && response.success) {
    response.data = { ...response.data, renamed: { [nodeName]: finalName } };
  }
  return response;
}

async function executeMkBatch(batchInput: string): Promise<ToolResponse> {
  const lines = batchInput.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('//'));

  if (lines.length === 0) {
    return { success: false, error: { code: 'EMPTY_BATCH', message: 'No mk commands in batch input.' } };
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

    const path = tokens[0];
    let type: string | undefined;
    let refComponent: string | undefined;
    let propsStart = 1;

    if (tokens[1]) {
      if (MK_TYPES.has(tokens[1])) { type = tokens[1]; propsStart = 2; }
      else if (tokens[1].startsWith('ref:')) { refComponent = tokens[1].slice(4); propsStart = 2; }
      else if (tokens[1] === 'ref' && tokens[2]) { refComponent = tokens[2]; propsStart = 3; }
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
    return { success: false, error: { code: 'PARSE_ERROR', message: 'No valid mk commands parsed from batch input.' } };
  }

  // ── Sequential symbol resolution ──
  // Key invariant: each line ALWAYS creates a new node with a unique symbol.
  // Parent lookup uses the LATEST symbol for that path (sequential association).
  // This ensures duplicate sibling names (e.g., multiple /Parent/Item) each get
  // their own symbol, and children reference the correct (most recent) parent.

  const latestSymbolForPath = new Map<string, string>();
  let symbolCounter = 0;

  // Pre-resolve page-level root collisions with existing Figma nodes
  const pageRootNames = new Set<string>();
  const nameDedup = new Map<string, string>();
  for (const line of parsed) {
    if (line.parentPath === '/') pageRootNames.add(line.nodeName);
  }
  for (const rootName of pageRootNames) {
    const resolved = await resolvePathToNode('/' + rootName);
    if (resolved.ok && !resolved.isPage) {
      nameDedup.set(rootName, deduplicateName(figma.currentPage.children, rootName));
    }
  }

  // Generate flat ops sequentially
  const opsLines: string[] = [];

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

    // Deduplicate page-level names that collide with existing designs
    const displayName = (line.parentPath === '/' && nameDedup.has(line.nodeName))
      ? nameDedup.get(line.nodeName)! : line.nodeName;

    const adjustedTokens = injectLayoutDefaults(line.type, line.propTokens);
    const propsInner = adjustedTokens.map(mkPropToFlatOps).join(', ');
    const propsWithName = injectNameProp(propsInner, displayName);

    if (line.type === 'variantset') {
      opsLines.push(`${sym} = variantSet(${parentRef}, {${propsWithName}})`);
    } else if (line.refComponent) {
      const escaped = escapeFlatOpsStr(line.refComponent);
      opsLines.push(`${sym} = ref('${escaped}', ${parentRef}, {${propsWithName}})`);
    } else if (line.type === 'text' || line.textContent) {
      const nodeType = line.type || 'text';
      const textArg = line.textContent ? `, '${escapeFlatOpsStr(line.textContent)}'` : '';
      opsLines.push(`${sym} = ${nodeType}(${parentRef}, {${propsWithName}}${textArg})`);
    } else {
      const nodeType = line.type || 'frame';
      opsLines.push(`${sym} = ${nodeType}(${parentRef}, {${propsWithName}})`);
    }
  }

  if (opsLines.length === 0) {
    return { success: true, data: { message: 'All nodes already exist. No changes needed.' } };
  }

  const response = await executeFlatOps(opsLines.join('\n'));
  if (nameDedup.size > 0 && response.success) {
    const renamed = Object.fromEntries(nameDedup);
    response.data = { ...response.data, renamed };
  }
  return response;
}

export async function handleMk(parameters: any): Promise<ToolResponse> {
  const { batch, path: mkPath, type: mkType, refComponent, propTokens, textContent } = parameters;

  if (batch) {
    return await executeMkBatch(batch);
  }

  if (!mkPath) {
    return { success: false, error: { code: 'INVALID_PATH', message: 'mk requires a path. Usage: mk /Card/ frame w:400 layout:column' } };
  }

  // Guard: detect embedded batch commands in propTokens
  if (propTokens && Array.isArray(propTokens) && propTokens.some((t: string) => /\nmk\s|^mk\s/.test(t))) {
    const reconstructed = `${mkPath}${mkType ? ' ' + mkType : ''} ${(propTokens || []).join(' ')}${textContent ? ' -- ' + textContent : ''}`;
    return await executeMkBatch(reconstructed);
  }

  return await executeSingleMk(mkPath, mkType, refComponent, propTokens || [], textContent);
}

// ── rm ──

export async function handleRm(parameters: any): Promise<ToolResponse> {
  const rmPath = parameters.path || '/';

  // Glob support
  if (hasGlob(rmPath)) {
    const globNodes = await resolveGlobPaths(rmPath);
    if (globNodes.length === 0) {
      return { success: false, error: { code: 'NO_MATCH', message: `No nodes matched pattern "${rmPath}". Use ls to check available children.` } };
    }
    const rmOps = globNodes.map(n => `delete('${n.id}')`).join('\n');
    return await executeFlatOps(rmOps);
  }

  const rmResolved = await resolvePathToNode(rmPath);
  if (!rmResolved.ok) return rmResolved.response;
  if (rmResolved.isPage) {
    return { success: false, error: { code: 'INVALID_TARGET', message: 'Cannot delete page root. Target a specific node, e.g. rm /Card/' } };
  }

  return await executeFlatOps(`delete('${rmResolved.node.id}')`);
}

// ── mv ──

export async function handleMv(parameters: any): Promise<ToolResponse> {
  const { sourcePath: mvSourcePath, destPath: mvDestPath } = parameters;

  if (!mvSourcePath) {
    return { success: false, error: { code: 'MISSING_SOURCE', message: 'mv requires a source path. Usage: mv /OldName /NewName' } };
  }
  if (!mvDestPath) {
    return { success: false, error: { code: 'MISSING_DEST', message: 'mv requires a destination path. Usage: mv /OldName /NewName' } };
  }

  const mvSourceResolved = await resolvePathToNode(mvSourcePath);
  if (!mvSourceResolved.ok) return mvSourceResolved.response;
  if (mvSourceResolved.isPage) {
    return { success: false, error: { code: 'INVALID_SOURCE', message: 'Cannot move page root.' } };
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
      return { success: false, error: { code: 'INVALID_DEST', message: 'Destination must include a name, e.g. mv /Card/OldTitle /Card/NewTitle' } };
    }
    mvNewName = mvTargetName;

    const mvParentResolved = await resolvePathToNode(mvParentPath);
    if (!mvParentResolved.ok) return mvParentResolved.response;

    if (mvParentResolved.isPage) {
      mvNewParent = figma.currentPage;
    } else if ('children' in mvParentResolved.node) {
      mvNewParent = mvParentResolved.node as BaseNode & ChildrenMixin;
    } else {
      return { success: false, error: { code: 'INVALID_DEST', message: `"${mvParentPath}" is not a container. Cannot move node there.` } };
    }
  }

  const mvRenamed = mvOldName !== mvNewName;
  if (mvRenamed) mvNode.name = mvNewName;

  const mvMoved = mvNewParent != null && mvNewParent.id !== mvOldParentId;
  if (mvMoved) (mvNewParent as any).appendChild(mvNode);

  return {
    success: true,
    data: {
      id: mvNode.id,
      oldName: mvOldName,
      newName: mvNewName,
      renamed: mvRenamed,
      moved: mvMoved,
      newParent: mvMoved ? mvNewParent!.name : undefined,
    },
  };
}

// ── cp ──

export async function handleCp(parameters: any): Promise<ToolResponse> {
  const { sourcePath: cpSourcePath, destPath: cpDestPath, propsRaw: cpPropsRaw } = parameters;

  if (!cpSourcePath) {
    return { success: false, error: { code: 'MISSING_SOURCE', message: 'cp requires a source path. Usage: cp /Source/ /Dest/ {overrides}' } };
  }
  if (!cpDestPath) {
    return { success: false, error: { code: 'MISSING_DEST', message: 'cp requires a destination path. Usage: cp /Source/ /Dest/ {overrides}' } };
  }

  const cpSourceResolved = await resolvePathToNode(cpSourcePath);
  if (!cpSourceResolved.ok) return cpSourceResolved.response;
  if (cpSourceResolved.isPage) {
    return { success: false, error: { code: 'INVALID_SOURCE', message: 'Cannot clone page root.' } };
  }
  const cpSourceId = cpSourceResolved.node.id;

  const { parentPath: cpParentPath, nodeName: cpCloneName } = splitPath(cpDestPath);
  if (!cpCloneName) {
    return { success: false, error: { code: 'INVALID_PATH', message: 'Destination path must include a name, e.g. /Card/Hover/' } };
  }

  const cpParentResolved = await resolvePathToNode(cpParentPath);
  if (!cpParentResolved.ok) return cpParentResolved.response;

  const cpParentId = cpParentResolved.isPage ? undefined : cpParentResolved.node.id;
  const cpPropsInner = stripBraces(cpPropsRaw || '');
  const cpPropsWithName = injectNameProp(cpPropsInner, cpCloneName);

  return await executeFlatOps(`n1 = clone('${cpSourceId}', root, {${cpPropsWithName}})`, cpParentId);
}
