/**
 * @file shared.ts
 * @description Shared utilities for IPC command handlers.
 *
 * exportNodeToBase64 — screenshot export.
 * Replace property helpers — used by run grep + run sed.
 */

// ── Screenshot export ──

interface ScreenshotResult {
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
    __image: { mimeType, data: base64 },
    width: Math.round(node.width * exportScale),
    height: Math.round(node.height * exportScale),
  };
}

// ── Replace property helpers (used by run grep + run sed) ──

import { rgbaToHex, parseHexToRGBA as hexToRgba } from '../../utils/colorUtils';

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
