/**
 * @file visibilityValidator.ts
 * @description Pre-check rules for Figma node visibility.
 */

export interface VisibilityIssue {
  type: 'opacity_zero' | 'zero_dimension' | 'invisible_border' | 'low_contrast';
  severity: 'error' | 'warning';
  message: string;
  suggestion?: string;
  autoFix?: () => void;
}

export interface VisibilityResult {
  valid: boolean;
  issues: VisibilityIssue[];
  autoFixed: string[];
}

/**
 * Validate visibility of a node.
 * ONLY errors should have autoFix.
 */
export function validateVisibility(node: SceneNode): VisibilityResult {
  const issues: VisibilityIssue[] = [];
  const autoFixed: string[] = [];

  // 1. Check Opacity (Clear bug)
  if ('opacity' in node && node.opacity === 0) {
    issues.push({
      type: 'opacity_zero',
      severity: 'error',
      message: 'Node has 0% opacity and is invisible.',
      autoFix: () => {
        (node as any).opacity = 1;
        autoFixed.push('opacity_zero');
      }
    });
  }

  // 2. Check Dimensions (Clear bug)
  if ('resize' in node && (node.width === 0 || node.height === 0)) {
    issues.push({
      type: 'zero_dimension',
      severity: 'error',
      message: 'Node has zero dimensions.',
      autoFix: () => {
        const w = node.width === 0 ? 1 : node.width;
        const h = node.height === 0 ? 1 : node.height;
        (node as any).resize(w, h);
        autoFixed.push('zero_dimension');
      }
    });
  }

  // 3. Check for Invisible Border (Subjective - Warning only)
  if ('fills' in node && 'strokes' in node) {
    const fills = node.fills as Paint[];
    const strokes = node.strokes as Paint[];
    
    const isWhiteFill = fills.some(f => f.type === 'SOLID' && isWhite(f.color));
    const isWhiteStroke = strokes.some(s => s.type === 'SOLID' && isWhite(s.color));

    if (isWhiteFill && isWhiteStroke && strokes.length > 0) {
      issues.push({
        type: 'invisible_border',
        severity: 'warning',
        message: 'White border on white background may be invisible.',
        suggestion: 'Consider using a grey border (#E0E0E0) or removing the stroke.'
      });
    }
  }

  // 4. Contrast check (Placeholder for future implementation)
  // TODO: Add actual contrast calculation for text nodes

  return {
    valid: issues.length === 0,
    issues,
    autoFixed
  };
}

/**
 * Helper to check if a color is white
 */
function isWhite(color: RGB): boolean {
  return color.r > 0.99 && color.g > 0.99 && color.b > 0.99;
}

/**
 * Apply auto-fixes for a node's visibility issues.
 */
export function autoFixVisibility(node: SceneNode): string[] {
  const result = validateVisibility(node);
  result.issues.filter(i => i.severity === 'error').forEach(i => i.autoFix?.());
  return result.autoFixed;
}
