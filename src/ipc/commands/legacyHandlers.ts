/**
 * @file legacyHandlers.ts
 * @description Legacy tool handlers — design, replace, query,
 * mkdir, mktext, write, ln. Kept for backward compatibility.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { fontBus } from '../../engine/figma-adapter/resources/FontBus';
import { resolveSceneNode, resolvePathToNode, splitPath } from './pathResolver';
import {
  executeFlatOps, stripBraces, escapeFlatOpsStr,
  injectNameProp, extractAllReplacePropertyValues, matchesReplaceValue,
  applyReplacePropertyValue,
} from './shared';

// ── design ──

export async function handleDesign(parameters: any): Promise<ToolResponse> {
  const { ops: designOps, parentId: designParentId } = parameters;

  if (!designOps || typeof designOps !== 'string' || designOps.trim().length === 0) {
    return { success: false, error: { code: 'EMPTY_OPS', message: 'No ops provided. Example: card = frame(root, {w:400, h:\'hug\', bg:\'#FFF\'})\ntitle = text(card, {}, \'Hello\')' } };
  }

  return await executeFlatOps(designOps, designParentId);
}

// ── replace ──

export async function handleReplace(parameters: any): Promise<ToolResponse> {
  const { mode: replaceMode, rootId: replaceRootId, properties: replaceProps, replacements } = parameters;

  if (replaceMode !== 'search' && replaceMode !== 'replace') {
    return { success: false, error: { code: 'INVALID_MODE', message: 'Mode must be "search" or "replace".' } };
  }

  const replaceRootResolved = await resolveSceneNode(replaceRootId);
  if (!replaceRootResolved.ok) return replaceRootResolved.response;
  const replaceRoot = replaceRootResolved.node;

  try {
    if (replaceMode === 'search') {
      if (!replaceProps || !Array.isArray(replaceProps) || replaceProps.length === 0) {
        return { success: false, error: { code: 'MISSING_PROPERTIES', message: 'Search mode requires a non-empty "properties" array.' } };
      }

      const uniqueValues: Record<string, Set<string | number>> = {};
      for (const prop of replaceProps) uniqueValues[prop] = new Set();

      function collectValues(node: SceneNode): void {
        for (const prop of replaceProps) {
          for (const val of extractAllReplacePropertyValues(node, prop)) uniqueValues[prop].add(val);
        }
        if ('children' in node) {
          for (const child of (node as any).children) collectValues(child);
        }
      }
      collectValues(replaceRoot);

      const result: Record<string, (string | number)[]> = {};
      for (const [prop, valueSet] of Object.entries(uniqueValues)) result[prop] = Array.from(valueSet);
      return { success: true, data: result };
    }

    // replace mode
    if (!replacements || typeof replacements !== 'object' || Object.keys(replacements).length === 0) {
      return { success: false, error: { code: 'MISSING_REPLACEMENTS', message: 'Replace mode requires a non-empty "replacements" object.' } };
    }

    let totalReplaced = 0;
    const details: Record<string, number> = {};

    // Phase 1: Collect and preload fonts
    const fontsToPreload = new Set<string>();
    const hasFontRules = replacements['fontFamily'] || replacements['fontWeight'];
    if (hasFontRules) {
      function collectFonts(node: SceneNode): void {
        if (node.type === 'TEXT') {
          const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
          const familyRules = replacements['fontFamily'];
          if (Array.isArray(familyRules)) {
            for (const rule of familyRules) {
              if (matchesReplaceValue(cur.family, rule.from) && typeof rule.to === 'string') {
                fontsToPreload.add(`${rule.to}\0${cur.style}`);
              }
            }
          }
          const weightRules = replacements['fontWeight'];
          if (Array.isArray(weightRules)) {
            for (const rule of weightRules) {
              if (matchesReplaceValue(cur.style, rule.from) && typeof rule.to === 'string') {
                fontsToPreload.add(`${cur.family}\0${rule.to}`);
              }
            }
          }
        }
        if ('children' in node) {
          for (const child of (node as any).children) collectFonts(child);
        }
      }
      collectFonts(replaceRoot);

      if (fontsToPreload.size > 0) {
        await Promise.all(
          [...fontsToPreload].map(key => {
            const [family, style] = key.split('\0');
            return fontBus.getOrLoad(family, style);
          })
        );
      }
    }

    // Phase 2: Apply replacements
    async function doReplace(node: SceneNode): Promise<void> {
      for (const [prop, rules] of Object.entries(replacements)) {
        if (!Array.isArray(rules)) continue;
        for (const rule of rules) {
          const n = await applyReplacePropertyValue(node, prop, rule.from, rule.to);
          if (n > 0) { totalReplaced += n; details[prop] = (details[prop] || 0) + n; }
        }
      }
      if ('children' in node) {
        for (const child of (node as any).children) await doReplace(child);
      }
    }
    await doReplace(replaceRoot);
    return { success: true, data: { replaced: totalReplaced, details } };
  } catch (e: any) {
    return { success: false, error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error during replace' } };
  }
}

// ── query (nodes only — knowledge handled locally in sandbox) ──

export async function handleQuery(parameters: any): Promise<ToolResponse> {
  const { source: querySource, query: queryText } = parameters;

  if (querySource !== 'nodes') {
    return { success: false, error: { code: 'INVALID_SOURCE', message: `Source "${querySource}" not available via IPC. Use query({source: "nodes", query: "..."}) to search the canvas.` } };
  }

  const searchQuery = (queryText || '').toLowerCase();
  const MAX_RESULTS = 20;
  const matches: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number }> = [];

  const allNodes = figma.currentPage.findAll(node => {
    return node.name.toLowerCase().includes(searchQuery)
      || node.type.toLowerCase() === searchQuery;
  });

  for (const node of allNodes.slice(0, MAX_RESULTS)) {
    matches.push({
      id: node.id, name: node.name, type: node.type,
      x: Math.round(node.x), y: Math.round(node.y),
      width: Math.round(node.width), height: Math.round(node.height),
    });
  }

  return {
    success: true,
    data: { results: matches, total: allNodes.length, truncated: allNodes.length > MAX_RESULTS }
  };
}

// ── Legacy FS write commands ──

export async function handleMkdir(parameters: any): Promise<ToolResponse> {
  const mkdirPath = parameters.path || '/';
  const mkdirType = parameters.type || 'frame';
  const mkdirPropsRaw = parameters.propsRaw || '';

  const { parentPath, nodeName } = splitPath(mkdirPath);
  if (!nodeName) {
    return { success: false, error: { code: 'INVALID_PATH', message: 'mkdir requires a target name in path, e.g. mkdir /Card/ or mkdir /Card/Header/' } };
  }

  const parentResolved = await resolvePathToNode(parentPath);
  if (!parentResolved.ok) return parentResolved.response;

  const parentId = parentResolved.isPage ? undefined : parentResolved.node.id;
  const propsInner = stripBraces(mkdirPropsRaw);
  const propsWithName = injectNameProp(propsInner, nodeName);

  return await executeFlatOps(`n1 = ${mkdirType}(root, {${propsWithName}})`, parentId);
}

export async function handleMktext(parameters: any): Promise<ToolResponse> {
  const mktextPath = parameters.path || '/';
  const mktextPropsRaw = parameters.propsRaw || '';
  const mktextContent = parameters.textContent || '';

  const { parentPath, nodeName } = splitPath(mktextPath);
  if (!nodeName) {
    return { success: false, error: { code: 'INVALID_PATH', message: 'mktext requires a target name in path, e.g. mktext /Card/Title' } };
  }

  const parentResolved = await resolvePathToNode(parentPath);
  if (!parentResolved.ok) return parentResolved.response;

  const parentId = parentResolved.isPage ? undefined : parentResolved.node.id;
  const propsInner = stripBraces(mktextPropsRaw);
  const propsWithName = injectNameProp(propsInner, nodeName);

  const escaped = escapeFlatOpsStr(mktextContent);
  const textArg = mktextContent ? `, '${escaped}'` : '';
  return await executeFlatOps(`n1 = text(root, {${propsWithName}}${textArg})`, parentId);
}

export async function handleWrite(parameters: any): Promise<ToolResponse> {
  const writePath = parameters.path || '/';
  const writePropsRaw = parameters.propsRaw || '';

  if (!writePropsRaw || stripBraces(writePropsRaw) === '') {
    return { success: false, error: { code: 'EMPTY_PROPS', message: 'write requires properties to update. Example: write /Card/ {bg:#000}' } };
  }

  const writeResolved = await resolvePathToNode(writePath);
  if (!writeResolved.ok) return writeResolved.response;
  if (writeResolved.isPage) {
    return { success: false, error: { code: 'INVALID_TARGET', message: 'Cannot write to page root. Target a specific node, e.g. write /Card/ {bg:#000}' } };
  }

  const writeNodeId = writeResolved.node.id;
  const writePropsBlock = writePropsRaw.trim().startsWith('{') ? writePropsRaw : `{${writePropsRaw}}`;
  return await executeFlatOps(`update('${writeNodeId}', ${writePropsBlock})`);
}

export async function handleLn(parameters: any): Promise<ToolResponse> {
  const { path: lnPath, component: lnComponent, propsRaw: lnPropsRaw } = parameters;

  if (!lnPath) {
    return { success: false, error: { code: 'MISSING_PATH', message: 'ln requires a path. Usage: ln /Card/BtnInst Button {overrides}' } };
  }
  if (!lnComponent) {
    return { success: false, error: { code: 'MISSING_COMPONENT', message: 'ln requires a component name. Usage: ln /Card/BtnInst Button' } };
  }

  const { parentPath, nodeName } = splitPath(lnPath);
  if (!nodeName) {
    return { success: false, error: { code: 'INVALID_PATH', message: 'Path must include an instance name, e.g. /Card/BtnInst' } };
  }

  const parentResolved = await resolvePathToNode(parentPath);
  if (!parentResolved.ok) return parentResolved.response;

  const parentId = parentResolved.isPage ? undefined : parentResolved.node.id;
  const propsInner = stripBraces(lnPropsRaw || '');
  const propsWithName = injectNameProp(propsInner, nodeName);

  const escapedComponent = escapeFlatOpsStr(lnComponent);
  return await executeFlatOps(`n1 = ref('${escapedComponent}', root, {${propsWithName}})`, parentId);
}
