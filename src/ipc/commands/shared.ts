/**
 * @file shared.ts
 * @description Shared utilities for IPC command handlers.
 *
 * executeFlatOps — the shared pipeline for all write operations.
 * exportNodeToBase64 — screenshot export.
 * mk helpers — prop token conversion, layout defaults, batch parsing.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { ActionExecutor } from '../../engine/actions/executor';
import { collectTreeViolations, type ValidationViolation } from '../../engine/validation/postOpValidator';
import { compileDesignOps } from '../../engine/flat/flatOpsParser';
import { logger } from '../../utils/logger';
import { buildCreateReceipt } from '../handlers/receiptBuilder';
import { resolveSceneNode } from './pathResolver';

// ── Flat Ops execution pipeline ──

export async function executeFlatOps(
  opsStr: string,
  parentId?: string,
): Promise<ToolResponse> {
  let compiled;
  try {
    compiled = compileDesignOps(opsStr, parentId, ActionExecutor.getRegisteredSymbols());
    if (compiled.ops.length === 0 && compiled.errors.length > 0) {
      return { success: false, error: { code: 'PARSE_ERROR', message: compiled.errors.map(e => `L${e.lineNumber}: ${e.error}`).join('; ') } };
    }
    if (compiled.diagnostics.length > 0) {
      logger.info('Design diagnostics', { diagnostics: compiled.diagnostics });
    }
  } catch (e: any) {
    return { success: false, error: { code: 'PARSE_ERROR', message: e.message } };
  }

  try {
    const SOFT_CREATE_LIMIT = 20;
    const executor = new ActionExecutor();
    const result = await executor.executeDesignOps(compiled.ops, compiled.errors, {
      onError: 'continue', rollbackMode: 'none', parentId,
    });

    const rootId = parentId || Object.values(result.idMap)[0];
    const violations = await collectViolationsForNodeIds([rootId], 5);

    const receipt = buildCreateReceipt({
      result,
      violations,
      softCreateLimit: SOFT_CREATE_LIMIT,
      createLineCount: compiled.ops.length,
    });

    if (compiled.diagnostics.length > 0) {
      receipt.diagnostics = compiled.diagnostics.slice(0, 10).map(d => ({
        code: d.code,
        severity: d.severity,
        message: d.message,
      }));
    }

    // Auto-pan viewport to newly created root node
    if (!parentId && Object.keys(result.idMap).length > 0) {
      const newRootId = Object.values(result.idMap)[0] as string;
      const newRootNode = await figma.getNodeByIdAsync(newRootId);
      if (newRootNode) figma.viewport.scrollAndZoomIntoView([newRootNode as SceneNode]);
    }

    if (result.hasErrors) {
      const parts: string[] = [];
      if (result.stats.created) parts.push(`${result.stats.created} created`);
      if (result.stats.edited) parts.push(`${result.stats.edited} edited`);
      if (result.stats.deleted) parts.push(`${result.stats.deleted} deleted`);
      if (result.stats.failed) parts.push(`${result.stats.failed} failed`);
      if (result.stats.skipped) parts.push(`${result.stats.skipped} skipped`);
      return { success: false, data: receipt, error: { code: 'PARTIAL_FAILURE', message: `${parts.join(', ')}. Use idMap for references.` } };
    }

    return { success: true, data: receipt };
  } catch (e: any) {
    return { success: false, error: { code: 'EXECUTION_ERROR', message: `${e?.message ?? 'Unexpected error'}. Verify node references with ls or tree, then retry.` } };
  }
}

export async function collectViolationsForNodeIds(
  nodeIds: Array<string | undefined>,
  maxDepth: number,
  maxViolations: number = 10
): Promise<ValidationViolation[] | undefined> {
  const uniqueNodeIds = [...new Set(nodeIds.filter((nodeId): nodeId is string => Boolean(nodeId)))];
  if (uniqueNodeIds.length === 0) return undefined;

  const violations: ValidationViolation[] = [];
  const seen = new Set<string>();

  for (const nodeId of uniqueNodeIds) {
    if (violations.length >= maxViolations) break;
    const resolved = await resolveSceneNode(nodeId);
    if (!resolved.ok) continue;

    const found = collectTreeViolations(resolved.node, maxDepth, maxViolations - violations.length);
    for (const violation of found) {
      const key = `${violation.nodeId}:${violation.code}:${violation.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push(violation);
      if (violations.length >= maxViolations) break;
    }
  }

  return violations.length > 0 ? violations : undefined;
}

// ── Screenshot export ──

interface ScreenshotResult {
  success: true;
  __image: { mimeType: string; data: string };
  width: number;
  height: number;
}

export async function exportNodeToBase64(
  node: SceneNode,
  scale: number = 1,
  format: 'png' | 'jpg' = 'png'
): Promise<ScreenshotResult> {
  const exportFormat = (format === 'png' ? 'PNG' : 'JPG') as 'PNG' | 'JPG';
  const exportScale = Math.min(Math.max(scale, 0.5), 2);
  const bytes = await node.exportAsync({
    format: exportFormat,
    constraint: { type: 'SCALE', value: exportScale }
  });

  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    base64 += CHARS[b0 >> 2] + CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    base64 += (i + 1 < bytes.length) ? CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    base64 += (i + 2 < bytes.length) ? CHARS[b2 & 63] : '=';
  }
  const mimeType = exportFormat === 'PNG' ? 'image/png' : 'image/jpeg';

  return {
    success: true,
    __image: { mimeType, data: base64 },
    width: Math.round(node.width * exportScale),
    height: Math.round(node.height * exportScale),
  };
}

// ── mk helpers ──

export function stripBraces(propsRaw: string): string {
  let s = propsRaw.trim();
  if (s.startsWith('{')) s = s.slice(1);
  if (s.endsWith('}')) s = s.slice(0, -1);
  return s.trim();
}

export function escapeFlatOpsStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function injectNameProp(propsInner: string, name: string): string {
  if (/\bname\s*:/.test(propsInner)) return propsInner;
  const escaped = escapeFlatOpsStr(name);
  return propsInner
    ? `name:'${escaped}', ${propsInner}`
    : `name:'${escaped}'`;
}

export function injectLayoutDefaults(type: string | undefined, propTokens: string[]): string[] {
  const effectiveType = type || 'frame';
  if (effectiveType !== 'frame' && effectiveType !== 'section') return propTokens;

  const hasLayout = propTokens.some(t => t.startsWith('layout:') || t.startsWith('layoutMode:'));
  if (!hasLayout) return propTokens;

  const hasExplicitH = propTokens.some(t =>
    t.startsWith('h:') || t.startsWith('height:') || t.startsWith('sizingV:')
  );
  const hasExplicitW = propTokens.some(t =>
    t.startsWith('w:') || t.startsWith('width:') || t.startsWith('sizingH:')
  );

  const result = [...propTokens];
  if (!hasExplicitH) result.push('h:hug');
  if (!hasExplicitW) result.push('w:hug');
  return result;
}

export function mkPropToFlatOps(token: string): string {
  const colonIdx = token.indexOf(':');
  if (colonIdx < 0) return token;
  const key = token.slice(0, colonIdx);
  const val = token.slice(colonIdx + 1);
  // set:ChildName:text → split on second colon
  if (key === 'set') {
    const secondColon = val.indexOf(':');
    if (secondColon >= 0) {
      const childName = val.slice(0, secondColon);
      const text = val.slice(secondColon + 1);
      return `set:${childName}:'${escapeFlatOpsStr(text)}'`;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(val)) return `${key}:${val}`;
  return `${key}:'${val.replace(/'/g, "\\'")}'`;
}

// ── Replace property helpers (used by grep properties + sed + legacy replace) ──

export function rgbaToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

export function hexToRgba(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return {
    r: parseInt(full.substring(0, 2), 16) / 255,
    g: parseInt(full.substring(2, 4), 16) / 255,
    b: parseInt(full.substring(4, 6), 16) / 255,
  };
}

export function extractAllReplacePropertyValues(node: SceneNode, prop: string): (string | number)[] {
  switch (prop) {
    case 'fillColor': {
      if (node.type === 'TEXT') return [];
      const fills = (node as any).fills;
      if (!Array.isArray(fills)) return [];
      return fills.filter((f: any) => f.type === 'SOLID').map((f: any) => rgbaToHex(f.color));
    }
    case 'textColor': {
      if (node.type !== 'TEXT') return [];
      const fills = (node as any).fills;
      if (!Array.isArray(fills)) return [];
      return fills.filter((f: any) => f.type === 'SOLID').map((f: any) => rgbaToHex(f.color));
    }
    case 'strokeColor': {
      const strokes = (node as any).strokes;
      if (!Array.isArray(strokes)) return [];
      return strokes.filter((s: any) => s.type === 'SOLID').map((s: any) => rgbaToHex(s.color));
    }
    case 'cornerRadius': { const v = (node as any).cornerRadius; return typeof v === 'number' ? [v] : []; }
    case 'gap': { const v = (node as any).itemSpacing; return typeof v === 'number' ? [v] : []; }
    case 'fontSize': { if (node.type !== 'TEXT') return []; const v = (node as any).fontSize; return typeof v === 'number' ? [v] : []; }
    case 'fontFamily': { if (node.type !== 'TEXT') return []; const v = (node as any).fontName; return typeof v === 'object' ? [v.family] : []; }
    case 'fontWeight': { if (node.type !== 'TEXT') return []; const v = (node as any).fontName; return typeof v === 'object' ? [v.style] : []; }
    case 'strokeWeight': { const v = (node as any).strokeWeight; return typeof v === 'number' ? [v] : []; }
    case 'opacity': { const v = (node as any).opacity; return typeof v === 'number' ? [v] : []; }
    default: return [];
  }
}

export function matchesReplaceValue(current: string | number, from: string | number): boolean {
  if (typeof current === 'number' && typeof from === 'number') return current === from;
  if (typeof current === 'string' && typeof from === 'string') return current.toUpperCase() === from.toUpperCase();
  return String(current) === String(from);
}

export async function applyReplacePropertyValue(node: SceneNode, prop: string, from: string | number, to: string | number): Promise<number> {
  const { fontBus } = await import('../../engine/figma-adapter/resources/FontBus');
  switch (prop) {
    case 'fillColor': {
      if (node.type === 'TEXT' || typeof to !== 'string') return 0;
      const fills = [...((node as any).fills || [])];
      let changed = false;
      for (let i = 0; i < fills.length; i++) {
        if (fills[i].type === 'SOLID' && matchesReplaceValue(rgbaToHex(fills[i].color), from)) {
          fills[i] = { ...fills[i], color: hexToRgba(to) };
          changed = true;
        }
      }
      if (changed) (node as any).fills = fills;
      return changed ? 1 : 0;
    }
    case 'textColor': {
      if (node.type !== 'TEXT' || typeof to !== 'string') return 0;
      const fills = [...((node as any).fills || [])];
      let changed = false;
      for (let i = 0; i < fills.length; i++) {
        if (fills[i].type === 'SOLID' && matchesReplaceValue(rgbaToHex(fills[i].color), from)) {
          fills[i] = { ...fills[i], color: hexToRgba(to) };
          changed = true;
        }
      }
      if (changed) (node as any).fills = fills;
      return changed ? 1 : 0;
    }
    case 'strokeColor': {
      if (typeof to !== 'string') return 0;
      const strokes = [...((node as any).strokes || [])];
      let changed = false;
      for (let i = 0; i < strokes.length; i++) {
        if (strokes[i].type === 'SOLID' && matchesReplaceValue(rgbaToHex(strokes[i].color), from)) {
          strokes[i] = { ...strokes[i], color: hexToRgba(to) };
          changed = true;
        }
      }
      if (changed) (node as any).strokes = strokes;
      return changed ? 1 : 0;
    }
    case 'cornerRadius': {
      const cur = (node as any).cornerRadius;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).cornerRadius = to; return 1; }
      return 0;
    }
    case 'gap': {
      const cur = (node as any).itemSpacing;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).itemSpacing = to; return 1; }
      return 0;
    }
    case 'fontSize': {
      if (node.type !== 'TEXT') return 0;
      const cur = (node as any).fontSize;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).fontSize = to; return 1; }
      return 0;
    }
    case 'fontFamily': {
      if (node.type !== 'TEXT' || typeof to !== 'string') return 0;
      const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
      if (!matchesReplaceValue(cur.family, from)) return 0;
      const { loadedStyle } = await fontBus.getOrLoad(to, cur.style);
      (node as any).fontName = { family: to, style: loadedStyle };
      return 1;
    }
    case 'fontWeight': {
      if (node.type !== 'TEXT' || typeof to !== 'string') return 0;
      const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
      if (!matchesReplaceValue(cur.style, from)) return 0;
      const { loadedStyle } = await fontBus.getOrLoad(cur.family, to);
      (node as any).fontName = { family: cur.family, style: loadedStyle };
      return 1;
    }
    case 'strokeWeight': {
      const cur = (node as any).strokeWeight;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).strokeWeight = to; return 1; }
      return 0;
    }
    case 'opacity': {
      const cur = (node as any).opacity;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).opacity = Math.max(0, Math.min(1, to)); return 1; }
      return 0;
    }
    default: return 0;
  }
}
