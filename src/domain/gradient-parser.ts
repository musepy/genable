/**
 * @file gradient-parser.ts
 * @description Parses CSS gradient syntax into Figma-compatible gradient data.
 *
 * Supported CSS formats:
 *   linear-gradient(135deg, #667eea 0%, #764ba2 100%)
 *   radial-gradient(circle, #667eea, #764ba2)
 *   conic-gradient(from 0deg, #ff0000, #00ff00, #0000ff)
 *
 * Figma-only format:
 *   diamond-gradient(#667eea, #764ba2)
 *
 * Each color stop supports:
 *   - Hex color: #RRGGBB or #RGB or #RRGGBBAA
 *   - Variable reference: $collection/name (passed through for handler binding)
 *   - Position: N% (optional, auto-distributed if omitted)
 *   - Opacity: N% after color (optional, encoded in color.a)
 */

import { parseHexToRGBA } from '../utils/colorUtils';
import type { RGBA } from '../utils/colorUtils';

// ─── Gradient domain types ──────────────────────────────────────────────────

export type GradientType = 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';

export interface ColorStop {
  color: RGBA;
  position: number;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedGradient {
  type: GradientType;
  stops: ColorStop[];
  /** CSS angle in degrees (0 = to top, 90 = to right). Only for linear. */
  angleDeg: number;
  /** Variable references in stops: index → $varName */
  variableRefs?: Map<number, string>;
}

// ─── CSS Type → Figma Type ───────────────────────────────────────────────────

const CSS_TYPE_MAP: Record<string, GradientType> = {
  'linear-gradient': 'GRADIENT_LINEAR',
  'radial-gradient': 'GRADIENT_RADIAL',
  'conic-gradient': 'GRADIENT_ANGULAR',
  'diamond-gradient': 'GRADIENT_DIAMOND',
};

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Check if a string looks like a CSS gradient.
 */
export function isGradientString(value: string): boolean {
  return /^(linear|radial|conic|diamond)-gradient\(/i.test(value.trim());
}

/**
 * Parse a CSS gradient string into a ParsedGradient.
 * Returns null if the string is not a valid gradient.
 */
export function parseGradient(value: string): ParsedGradient | null {
  const trimmed = value.trim();

  // Match: type-gradient(...)
  const match = trimmed.match(/^([\w-]+gradient)\((.+)\)$/is);
  if (!match) return null;

  const cssType = match[1].toLowerCase();
  const figmaType = CSS_TYPE_MAP[cssType];
  if (!figmaType) return null;

  const inner = match[2];

  // Parse the inner content: angle/direction, then color stops
  const tokens = splitGradientArgs(inner);
  let angleDeg = 180; // CSS default: top to bottom
  let stopTokens = tokens;

  // First token might be angle or direction
  if (tokens.length > 0) {
    const angleResult = parseAngleOrDirection(tokens[0]);
    if (angleResult !== null) {
      angleDeg = angleResult;
      stopTokens = tokens.slice(1);
    }
  }

  // Parse color stops
  const { stops, variableRefs } = parseColorStops(stopTokens);

  if (stops.length < 2) return null;

  return {
    type: figmaType,
    stops,
    angleDeg,
    variableRefs: variableRefs.size > 0 ? variableRefs : undefined,
  };
}

// ─── Angle Parsing ───────────────────────────────────────────────────────────

const DIRECTION_MAP: Record<string, number> = {
  'to top': 0,
  'to top right': 45,
  'to right': 90,
  'to bottom right': 135,
  'to bottom': 180,
  'to bottom left': 225,
  'to left': 270,
  'to top left': 315,
  // conic-gradient "from Ndeg"
};

function parseAngleOrDirection(token: string): number | null {
  const trimmed = token.trim().toLowerCase();

  // "135deg" or "135"
  const degMatch = trimmed.match(/^([\d.]+)\s*(?:deg)?$/);
  if (degMatch) return parseFloat(degMatch[1]);

  // "from 0deg" (conic-gradient)
  const fromMatch = trimmed.match(/^from\s+([\d.]+)\s*(?:deg)?$/);
  if (fromMatch) return parseFloat(fromMatch[1]);

  // "to right", "to bottom left", etc.
  if (DIRECTION_MAP[trimmed] !== undefined) return DIRECTION_MAP[trimmed];

  // "circle", "ellipse" (radial-gradient shape — not an angle, skip)
  if (trimmed === 'circle' || trimmed === 'ellipse') return 0;

  return null;
}

// ─── Color Stop Parsing ──────────────────────────────────────────────────────

function parseColorStops(tokens: string[]): {
  stops: ColorStop[];
  variableRefs: Map<number, string>;
} {
  const rawStops: { color: RGBA; position?: number; varRef?: string }[] = [];
  const variableRefs = new Map<number, string>();

  for (const token of tokens) {
    const parts = token.trim().split(/\s+/);
    if (parts.length === 0) continue;

    const colorPart = parts[0];
    let position: number | undefined;
    let opacity: number | undefined;

    // Parse position and opacity from remaining parts
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (p.endsWith('%')) {
        const val = parseFloat(p);
        if (position === undefined) {
          position = val / 100; // Convert % to 0-1
        } else {
          opacity = val / 100; // Second % is opacity
        }
      }
    }

    // Parse color
    let color: RGBA;
    let varRef: string | undefined;

    if (colorPart.startsWith('$')) {
      // Variable reference — use placeholder color, handler will bind later
      varRef = colorPart;
      color = { r: 0, g: 0, b: 0, a: 1 };
    } else if (colorPart.startsWith('#')) {
      color = parseHexToRGBA(colorPart);
    } else if (colorPart === 'transparent') {
      color = { r: 0, g: 0, b: 0, a: 0 };
    } else {
      // Unknown color — fallback to black
      color = { r: 0, g: 0, b: 0, a: 1 };
    }

    // Apply opacity override
    if (opacity !== undefined) {
      color = { ...color, a: opacity };
    }

    rawStops.push({ color, position, varRef });
  }

  // Auto-distribute positions for stops without explicit position
  const stops = distributePositions(rawStops);

  // Collect variable refs
  rawStops.forEach((s, i) => {
    if (s.varRef) variableRefs.set(i, s.varRef);
  });

  return { stops, variableRefs };
}

/**
 * Auto-distribute stop positions. CSS behavior:
 * - First stop defaults to 0, last to 1
 * - Intermediate stops without position are evenly distributed between neighbors
 */
function distributePositions(
  rawStops: { color: RGBA; position?: number }[],
): ColorStop[] {
  if (rawStops.length === 0) return [];

  // Set first and last defaults
  const resolved = rawStops.map((s, i) => ({
    color: s.color,
    position: s.position ?? (i === 0 ? 0 : i === rawStops.length - 1 ? 1 : undefined),
  }));

  // Fill gaps by linear interpolation
  let lastResolved = 0;
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i].position !== undefined) {
      // Fill any gaps between lastResolved and i
      const gap = i - lastResolved;
      if (gap > 1) {
        const startPos = resolved[lastResolved].position!;
        const endPos = resolved[i].position!;
        for (let j = lastResolved + 1; j < i; j++) {
          resolved[j].position = startPos + (endPos - startPos) * ((j - lastResolved) / gap);
        }
      }
      lastResolved = i;
    }
  }

  return resolved.map(s => ({
    color: s.color,
    position: s.position ?? 0,
  }));
}

// ─── Gradient Transform ──────────────────────────────────────────────────────

type Transform2D = [[number, number, number], [number, number, number]];

/**
 * Convert a CSS angle (in degrees) to a Figma gradientTransform matrix.
 *
 * CSS angles: 0deg = to top, 90deg = to right (clockwise)
 * Figma gradient transform: 2x3 affine matrix mapping [0,0]-[1,1] UV space
 * to the gradient line endpoints.
 *
 * The matrix transforms the unit square [0,1]×[0,1] such that the gradient
 * line runs from the start color to the end color at the specified angle.
 */
export function cssAngleToGradientTransform(angleDeg: number): Transform2D {
  // CSS angle: 0=top, 90=right (clockwise)
  // Convert to radians, adjusted for Figma's coordinate system
  const rad = (angleDeg * Math.PI) / 180;

  // Direction vector from CSS angle
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);

  // The gradient line passes through center (0.5, 0.5)
  // Scale to cover the full node (handle the 45deg corner case)
  const length = Math.abs(dx) + Math.abs(dy); // Manhattan distance normalization

  // Start and end points on the gradient line
  const startX = 0.5 - (dx / length) * 0.5;
  const startY = 0.5 - (dy / length) * 0.5;
  const endX = 0.5 + (dx / length) * 0.5;
  const endY = 0.5 + (dy / length) * 0.5;

  // Build the affine matrix that maps:
  //   (0,0) → start point
  //   (1,0) → end point
  // The second row maps the perpendicular direction
  return [
    [endX - startX, -(endY - startY), startX],
    [endY - startY, endX - startX, startY],
  ];
}

/**
 * Get the default gradientTransform for a given gradient type.
 * For non-linear gradients, the transform controls shape/position.
 */
export function getGradientTransform(
  type: GradientType,
  angleDeg: number,
): Transform2D {
  switch (type) {
    case 'GRADIENT_LINEAR':
      return cssAngleToGradientTransform(angleDeg);
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_DIAMOND':
      // Centered radial/diamond: identity-ish, scaled to cover node
      // The angle parameter is ignored for radial/diamond
      return [[0.5, 0, 0.25], [0, 0.5, 0.25]];
    case 'GRADIENT_ANGULAR':
      // Angular (conic): rotation matters
      // Rotate by angleDeg around center
      return cssAngleToGradientTransform(angleDeg);
    default:
      return [[1, 0, 0], [0, 1, 0]];
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Split gradient arguments by comma, respecting nested parentheses.
 * "135deg, #667eea 0%, rgba(0,0,0,0.5) 100%" → ["135deg", "#667eea 0%", "rgba(0,0,0,0.5) 100%"]
 */
function splitGradientArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.substring(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.substring(start).trim());
  return parts.filter(Boolean);
}
