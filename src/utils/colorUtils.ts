/**
 * @file colorUtils.ts
 * @description Figma 0-1 RGBA ↔ hex string — one symmetric pair.
 *
 *   parseHexToRGBA:  "#FF0000"  → {r:1, g:0, b:0, a:1}
 *   rgbaToHex:       {r:1, g:0, b:0}  → "#FF0000"
 */

export interface RGB {
    r: number;
    g: number;
    b: number;
}

export interface RGBA extends RGB {
    a: number;
}

/**
 * Hex string → RGBA (0-1 range).
 * Accepts #RGB, #RRGGBB, #RRGGBBAA. Invalid input THROWS — silent-black
 * fallbacks were a latent bug (May 2026 cutover analysis) that masked
 * upstream param-shape mistakes (e.g. stringified `{variable_id}` objects
 * flowing into the paint pipeline).
 */
export function parseHexToRGBA(hex: string): RGBA {
    const clean = hex.replace('#', '');
    if (clean.length === 3) {
        return {
            r: parseInt(clean[0] + clean[0], 16) / 255,
            g: parseInt(clean[1] + clean[1], 16) / 255,
            b: parseInt(clean[2] + clean[2], 16) / 255,
            a: 1,
        };
    }
    if (clean.length === 6 || clean.length === 8) {
        const r = parseInt(clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.slice(4, 6), 16) / 255;
        const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
        if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
            throw new Error(`parseHexToRGBA: invalid hex "${hex}"`);
        }
        return { r, g, b, a };
    }
    throw new Error(`parseHexToRGBA: invalid hex "${hex}"`);
}

/**
 * RGBA (0-1 range) → hex string.
 * Alpha is optional (defaults to 1). Only appended to output when < 1.
 */
export function rgbaToHex(color: { r: number; g: number; b: number; a?: number }): string {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const toHex = (c: number) => Math.round(clamp(c) * 255).toString(16).padStart(2, '0');
    const hex = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`.toUpperCase();
    if (color.a !== undefined && color.a < 1) {
        return `${hex}${toHex(color.a)}`.toUpperCase();
    }
    return hex;
}
