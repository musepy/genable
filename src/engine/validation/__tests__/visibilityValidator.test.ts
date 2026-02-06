import { describe, it, expect, vi } from 'vitest';
import { validateVisibility } from '../visibilityValidator';

describe('visibilityValidator', () => {
  it('should detect and auto-fix opacity 0', () => {
    const mockNode = {
      opacity: 0,
      width: 100,
      height: 100
    } as any;

    const result = validateVisibility(mockNode);
    expect(result.valid).toBe(false);
    expect(result.issues[0].type).toBe('opacity_zero');
    
    result.issues[0].autoFix?.();
    expect(mockNode.opacity).toBe(1);
  });

  it('should detect and auto-fix zero dimensions', () => {
    const mockNode = {
      opacity: 1,
      width: 0,
      height: 100,
      resize: vi.fn((w, h) => {
        mockNode.width = w;
        mockNode.height = h;
      })
    } as any;

    const result = validateVisibility(mockNode);
    expect(result.issues[0].type).toBe('zero_dimension');
    
    result.issues[0].autoFix?.();
    expect(mockNode.width).toBe(1);
  });

  it('should warn about white border on white background', () => {
    const mockNode = {
      opacity: 1,
      width: 100,
      height: 100,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
      strokes: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
    } as any;

    const result = validateVisibility(mockNode);
    expect(result.valid).toBe(false);
    expect(result.issues[0].type).toBe('invisible_border');
    expect(result.issues[0].severity).toBe('warning');
    expect(result.issues[0].autoFix).toBeUndefined();
  });

  it('should pass for normal nodes', () => {
    const mockNode = {
      opacity: 1,
      width: 100,
      height: 100,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      strokes: []
    } as any;

    const result = validateVisibility(mockNode);
    expect(result.valid).toBe(true);
    expect(result.issues.length).toBe(0);
  });
});
