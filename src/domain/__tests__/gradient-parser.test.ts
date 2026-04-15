/**
 * @file gradient-parser.test.ts
 * @description P0 baseline tests for gradient-parser.ts trig logic.
 * These tests run against the original implementation BEFORE porting to templateFunctions.
 * After porting, the same tests verify equivalence.
 */

import { describe, it, expect } from 'vitest';
import {
  cssAngleToGradientTransform,
  getGradientTransform,
  parseGradient,
  isGradientString,
} from '../gradient-parser';

// Helper: approximate matrix comparison (floating point)
function expectTransformClose(
  actual: [[number, number, number], [number, number, number]],
  expected: [[number, number, number], [number, number, number]],
  precision = 4,
) {
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 3; j++) {
      expect(actual[i][j]).toBeCloseTo(expected[i][j], precision);
    }
  }
}

describe('gradient-parser baseline', () => {
  describe('isGradientString', () => {
    it('recognizes linear-gradient', () => {
      expect(isGradientString('linear-gradient(135deg, #667eea, #764ba2)')).toBe(true);
    });

    it('recognizes radial-gradient', () => {
      expect(isGradientString('radial-gradient(circle, #FFF, #000)')).toBe(true);
    });

    it('recognizes conic-gradient', () => {
      expect(isGradientString('conic-gradient(from 0deg, #F00, #0F0)')).toBe(true);
    });

    it('rejects non-gradient strings', () => {
      expect(isGradientString('#FF0000')).toBe(false);
      expect(isGradientString('solid color')).toBe(false);
    });
  });

  describe('cssAngleToGradientTransform', () => {
    it('0deg → to top', () => {
      const t = cssAngleToGradientTransform(0);
      // 0deg = to top: start=(0.5,1), end=(0.5,0)
      // Row0: [endX-startX, -(endY-startY), startX] = [0, 1, 0.5]
      // Row1: [endY-startY, endX-startX, startY] = [-1, 0, 1]
      expectTransformClose(t, [[0, 1, 0.5], [-1, 0, 1]]);
    });

    it('180deg → to bottom (default)', () => {
      const t = cssAngleToGradientTransform(180);
      // 180deg = to bottom: start=(0.5,0), end=(0.5,1)
      // Row0: [0, -(1-0), 0.5] = [0, -1, 0.5]
      // Row1: [1, 0, 0]
      expectTransformClose(t, [[0, -1, 0.5], [1, 0, 0]]);
    });

    it('90deg → left to right', () => {
      const t = cssAngleToGradientTransform(90);
      // 90deg = to right. start = (0, 0.5), end = (1, 0.5)
      expectTransformClose(t, [[1, 0, 0], [0, 1, 0.5]]);
    });

    it('270deg → right to left', () => {
      const t = cssAngleToGradientTransform(270);
      expectTransformClose(t, [[-1, 0, 1], [0, -1, 0.5]]);
    });

    it('135deg → diagonal', () => {
      const t = cssAngleToGradientTransform(135);
      // Diagonal: matrix should have non-zero off-diagonal elements
      expect(t[0][0]).not.toBe(0);
      expect(t[1][0]).not.toBe(0);
    });

    it('45deg → opposite diagonal', () => {
      const t = cssAngleToGradientTransform(45);
      expect(t[0][0]).not.toBe(0);
      expect(t[1][0]).not.toBe(0);
    });
  });

  describe('getGradientTransform', () => {
    it('linear delegates to cssAngleToGradientTransform', () => {
      const fromGet = getGradientTransform('GRADIENT_LINEAR', 135);
      const direct = cssAngleToGradientTransform(135);
      expectTransformClose(fromGet, direct);
    });

    it('radial uses centered transform', () => {
      const t = getGradientTransform('GRADIENT_RADIAL', 0);
      expectTransformClose(t, [[0.5, 0, 0.25], [0, 0.5, 0.25]]);
    });

    it('diamond uses centered transform', () => {
      const t = getGradientTransform('GRADIENT_DIAMOND', 0);
      expectTransformClose(t, [[0.5, 0, 0.25], [0, 0.5, 0.25]]);
    });

    it('angular uses angle-based transform', () => {
      const t = getGradientTransform('GRADIENT_ANGULAR', 90);
      const linear = cssAngleToGradientTransform(90);
      expectTransformClose(t, linear);
    });
  });

  describe('parseGradient', () => {
    it('parses linear-gradient with angle and stops', () => {
      const result = parseGradient('linear-gradient(135deg, #667eea 0%, #764ba2 100%)');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('GRADIENT_LINEAR');
      expect(result!.angleDeg).toBe(135);
      expect(result!.stops).toHaveLength(2);
      expect(result!.stops[0].position).toBeCloseTo(0);
      expect(result!.stops[1].position).toBeCloseTo(1);
    });

    it('parses gradient without explicit positions', () => {
      const result = parseGradient('linear-gradient(90deg, #FF0000, #00FF00, #0000FF)');
      expect(result).not.toBeNull();
      expect(result!.stops).toHaveLength(3);
      expect(result!.stops[0].position).toBeCloseTo(0);
      expect(result!.stops[1].position).toBeCloseTo(0.5);
      expect(result!.stops[2].position).toBeCloseTo(1);
    });

    it('parses radial-gradient', () => {
      const result = parseGradient('radial-gradient(circle, #FFF, #000)');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('GRADIENT_RADIAL');
    });

    it('returns null for invalid input', () => {
      expect(parseGradient('#FF0000')).toBeNull();
      expect(parseGradient('not a gradient')).toBeNull();
    });

    it('requires at least 2 stops', () => {
      expect(parseGradient('linear-gradient(0deg, #FF0000)')).toBeNull();
    });
  });
});
