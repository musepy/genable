/**
 * @file colorUtils.ts
 * @description Unified color parsing utilities following SSOT and SOLID principles.
 * 
 * Leveraging figma.util for polymorphic parsing of Hex, RGB, RGBA, and Object formats.
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
 * Universal color parser using Figma's official utilities.
 * Handles strings (Hex, rgb, rgba, hsl) and RGBA objects.
 * 
 * @param input - Anything that might be a color (string or object)
 * @param defaultAlpha - Fallback alpha (0-1)
 * @returns RGBA object in Figma's 0-1 range
 */
export function parseColor(input: any, defaultAlpha: number = 1): RGBA {
    if (!input) {
        return { r: 0, g: 0, b: 0, a: defaultAlpha };
    }

    try {
        // Handle case where input is already a Figma-compatible RGBA object (0-1 range)
        if (typeof input === 'object' && 'r' in input && 'g' in input && 'b' in input) {
            return {
                r: clamp(input.r),
                g: clamp(input.g),
                b: clamp(input.b),
                a: typeof input.a === 'number' ? clamp(input.a) : defaultAlpha
            };
        }

        // Leveraging Figma's robust built-in parser (handles strings, hex, CSS-like formats)
        const parsed = figma.util.rgba(input);
        return {
            r: parsed.r,
            g: parsed.g,
            b: parsed.b,
            a: parsed.a ?? defaultAlpha
        };
    } catch (e) {
        // Log error only in debug/dev if needed, otherwise fallback gracefully
        return { r: 0, g: 0, b: 0, a: defaultAlpha };
    }
}

/**
 * Specialized parser for Hex - now a thin wrapper around parseColor for SSOT.
 */
export function parseHexColor(colorStr: any, defaultAlpha: number = 1): RGBA {
    return parseColor(colorStr, defaultAlpha);
}

/**
 * Specialized parser for RGBA strings - now a thin wrapper around parseColor for SSOT.
 */
export function parseRgbaColor(colorStr: any, defaultAlpha: number = 1): RGBA {
    return parseColor(colorStr, defaultAlpha);
}

/**
 * Convenience wrapper for Figma compatibility.
 */
export function parseColorForFigma(colorStr: any): RGBA {
    return parseColor(colorStr);
}

/**
 * Convert RGB values (0-1 range) to hex string
 */
export function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (c: number) => Math.round(clamp(c) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Convert RGBA values (0-1 range) to hex string with alpha
 */
export function rgbaToHex(r: number, g: number, b: number, a: number): string {
    const toHex = (c: number) => Math.round(clamp(c) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`.toUpperCase();
}

/**
 * Internal helper to ensure values are in 0-1 range
 */
function clamp(v: number): number {
    return Math.max(0, Math.min(1, v));
}
