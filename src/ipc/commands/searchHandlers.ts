/**
 * @file searchHandlers.ts
 * @description grep, sed command handlers — search and batch replace operations.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode } from './pathResolver';
import {
  extractAllReplacePropertyValues, matchesReplaceValue, applyReplacePropertyValue,
} from './shared';

// ── grep ──

export async function handleGrep(parameters: any): Promise<ToolResponse> {
  const { mode: grepMode, query: grepQuery, path: grepPath, properties: grepProps } = parameters;

  if (grepMode === 'properties') {
    // Property discovery mode
    if (!grepPath) {
      return { success: false, error: { code: 'MISSING_PATH', message: 'Property discovery requires a path. Usage: grep /Card/ fillColor,fontSize' } };
    }
    if (!grepProps || !Array.isArray(grepProps) || grepProps.length === 0) {
      return { success: false, error: { code: 'MISSING_PROPERTIES', message: 'Specify properties to discover. Usage: grep /Card/ fillColor,fontSize' } };
    }

    const grepResolved = await resolvePathToNode(grepPath);
    if (!grepResolved.ok) return grepResolved.response;

    const grepRoot = grepResolved.isPage
      ? figma.currentPage.children[0] as SceneNode
      : grepResolved.node;

    if (!grepRoot) {
      return { success: false, error: { code: 'NO_RESULTS', message: 'No nodes found to search.' } };
    }

    const uniqueValues: Record<string, Set<string | number>> = {};
    for (const prop of grepProps) uniqueValues[prop] = new Set();

    function collectGrepValues(node: SceneNode): void {
      for (const prop of grepProps!) {
        for (const val of extractAllReplacePropertyValues(node, prop)) uniqueValues[prop].add(val);
      }
      if ('children' in node) {
        for (const child of (node as any).children) collectGrepValues(child);
      }
    }

    if (grepResolved.isPage) {
      for (const child of figma.currentPage.children) collectGrepValues(child);
    } else {
      collectGrepValues(grepRoot);
    }

    const grepResult: Record<string, (string | number)[]> = {};
    for (const [prop, valueSet] of Object.entries(uniqueValues)) grepResult[prop] = Array.from(valueSet);
    return { success: true, data: grepResult };
  }

  // Node search mode
  const searchQuery = (grepQuery || '').toLowerCase();
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

  return { success: true, data: { results: matches, total: allNodes.length, truncated: allNodes.length > MAX_RESULTS } };
}

// ── sed ──

export async function handleSed(parameters: any): Promise<ToolResponse> {
  const { path: sedPath, replacements: sedReplacements } = parameters;

  if (!sedPath) {
    return { success: false, error: { code: 'MISSING_PATH', message: 'sed requires a path. Usage: sed /Card/ fillColor:#FFF/#000' } };
  }
  if (!sedReplacements || typeof sedReplacements !== 'object' || Object.keys(sedReplacements).length === 0) {
    return { success: false, error: { code: 'MISSING_REPLACEMENTS', message: 'sed requires replacement rules. Usage: sed /Card/ prop:from/to' } };
  }

  const sedResolved = await resolvePathToNode(sedPath);
  if (!sedResolved.ok) return sedResolved.response;
  if (sedResolved.isPage) {
    return { success: false, error: { code: 'INVALID_TARGET', message: 'Cannot sed page root. Target a specific node.' } };
  }
  const sedRoot = sedResolved.node;

  try {
    // Phase 1: Preload fonts
    const fontsToPreload = new Set<string>();
    const hasFontRules = sedReplacements['fontFamily'] || sedReplacements['fontWeight'];
    if (hasFontRules) {
      function collectFontsForSed(node: SceneNode): void {
        if (node.type === 'TEXT') {
          const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
          if (Array.isArray(sedReplacements['fontFamily'])) {
            for (const rule of sedReplacements['fontFamily']) {
              if (matchesReplaceValue(cur.family, rule.from) && typeof rule.to === 'string') {
                fontsToPreload.add(`${rule.to}\0${cur.style}`);
              }
            }
          }
          if (Array.isArray(sedReplacements['fontWeight'])) {
            for (const rule of sedReplacements['fontWeight']) {
              if (matchesReplaceValue(cur.style, rule.from) && typeof rule.to === 'string') {
                fontsToPreload.add(`${cur.family}\0${rule.to}`);
              }
            }
          }
        }
        if ('children' in node) {
          for (const child of (node as any).children) collectFontsForSed(child);
        }
      }
      collectFontsForSed(sedRoot);
      if (fontsToPreload.size > 0) {
        const { fontBus } = await import('../../engine/figma-adapter/resources/FontBus');
        await Promise.all([...fontsToPreload].map(key => {
          const [family, style] = key.split('\0');
          return fontBus.getOrLoad(family, style);
        }));
      }
    }

    // Phase 2: Apply replacements
    let totalReplaced = 0;
    const details: Record<string, number> = {};
    async function doSedReplace(node: SceneNode): Promise<void> {
      for (const [prop, rules] of Object.entries(sedReplacements)) {
        if (!Array.isArray(rules)) continue;
        for (const rule of rules) {
          const n = await applyReplacePropertyValue(node, prop, rule.from, rule.to);
          if (n > 0) { totalReplaced += n; details[prop] = (details[prop] || 0) + n; }
        }
      }
      if ('children' in node) {
        for (const child of (node as any).children) await doSedReplace(child);
      }
    }
    await doSedReplace(sedRoot);
    return { success: true, data: { replaced: totalReplaced, details } };
  } catch (e: any) {
    return { success: false, error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error during sed' } };
  }
}
