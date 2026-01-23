/**
 * @file constraintValidator.ts
 * @description Formal Layout Constraint Validation System
 * 
 * [INPUT]:  Validated NodeLayer tree
 * [OUTPUT]: LintWarning[] with machine-readable feedback
 * [POS]:    Between postProcessor and Self-Correction Loop
 * 
 * This is NOT a heuristic rule engine. It validates mathematical constraints
 * derived from Figma Auto Layout semantics:
 * 
 * 1. Sizing Mode Conflicts (FIXED + width, HUG + width)
 * 2. Parent-Child Dependency Cycles (HUG parent + FILL child)
 * 3. Auto Layout Requirements (HUG/FILL require layout mode)
 * 
 * Based on research:
 * - CSS Flexbox spec (W3C)
 * - Figma Auto Layout official behavior
 * - Cassowary constraint solver principles
 */

import { NodeLayer } from '../../schema/layerSchema';
import { LintWarning } from './types';

// ==========================================
// CONSTRAINT RULES (Non-Heuristic)
// ==========================================

/**
 * Rule 1: Sizing Mode and Dimension Mutual Exclusion
 * 
 * Mathematical rule:
 * - FIXED sizing → width/height IS used (required for deterministic layout)
 * - HUG sizing → width/height IS IGNORED (size determined by content)
 * - FILL sizing → width/height IS IGNORED (size determined by parent)
 * 
 * This is not a "fix", but a formal constraint from Figma's layout model.
 */
function validateSizingDimensionConflict(
  node: NodeLayer,
  path: string[]
): LintWarning[] {
  const warnings: LintWarning[] = [];
  const props = node.props || {};
  const nodeName = props.name || 'unnamed';
  const nodePath = [...path, nodeName].join(' > ');

  // Horizontal axis
  if (props.layoutSizingHorizontal === 'HUG' && props.width !== undefined) {
    warnings.push({
      rule: 'SizingDimensionConflict',
      nodePath,
      nodeName,
      severity: 'warning',
      humanMessage: `CONSTRAINT: width is ignored when layoutSizingHorizontal='HUG'. Content determines width.`,
      machineReadable: {
        field: 'props.width',
        actual: props.width,
        expected: undefined,
        constraint: 'HUG mode ignores explicit width. Remove width or change to layoutSizingHorizontal="FIXED"'
      }
    });
  }

  // Vertical axis
  if (props.layoutSizingVertical === 'HUG' && props.height !== undefined) {
    warnings.push({
      rule: 'SizingDimensionConflict',
      nodePath,
      nodeName,
      severity: 'warning',
      humanMessage: `CONSTRAINT: height is ignored when layoutSizingVertical='HUG'. Content determines height.`,
      machineReadable: {
        field: 'props.height',
        actual: props.height,
        expected: undefined,
        constraint: 'HUG mode ignores explicit height. Remove height or change to layoutSizingVertical="FIXED"'
      }
    });
  }

  // FILL + dimension is also a conflict (less common but still invalid)
  if (props.layoutSizingHorizontal === 'FILL' && props.width !== undefined) {
    warnings.push({
      rule: 'SizingDimensionConflict',
      nodePath,
      nodeName,
      severity: 'warning',
      humanMessage: `CONSTRAINT: width is ignored when layoutSizingHorizontal='FILL'. Parent determines width.`,
      machineReadable: {
        field: 'props.width',
        actual: props.width,
        expected: undefined,
        constraint: 'FILL mode ignores explicit width. Remove width or change to layoutSizingHorizontal="FIXED"'
      }
    });
  }

  return warnings;
}

/**
 * Rule 2: Parent-Child Dependency Cycle Detection
 * 
 * Mathematical rule:
 * - HUG parent + FILL child = CIRCULAR DEPENDENCY (unsolvable)
 * 
 * In Figma, this configuration causes the parent to auto-switch to FIXED.
 * We flag this as an error so the LLM can correct it explicitly.
 * 
 * Dependency graph:
 * - Parent.size depends on Child.size (HUG)
 * - Child.size depends on Parent.size (FILL)
 * → Cycle detected!
 */
function validateParentChildDependency(
  node: NodeLayer,
  parentSizingH: string | undefined,
  parentSizingV: string | undefined,
  parentHasLayout: boolean,
  path: string[]
): LintWarning[] {
  const warnings: LintWarning[] = [];
  const props = node.props || {};
  const nodeName = props.name || 'unnamed';
  const nodePath = [...path, nodeName].join(' > ');

  // Only applies if parent has Auto Layout (otherwise FILL/HUG are meaningless)
  if (!parentHasLayout) return warnings;

  // Horizontal axis cycle: parent HUG + child FILL
  if (parentSizingH === 'HUG' && props.layoutSizingHorizontal === 'FILL') {
    warnings.push({
      rule: 'ParentChildDependencyCycle',
      nodePath,
      nodeName,
      severity: 'error',
      humanMessage: `CONSTRAINT VIOLATION: FILL child in HUG parent creates circular dependency (horizontal axis).`,
      machineReadable: {
        field: 'props.layoutSizingHorizontal',
        actual: 'FILL',
        expected: 'HUG or FIXED',
        constraint: 'FILL child cannot exist in HUG parent. Change parent to FIXED/FILL, or change child to HUG/FIXED'
      }
    });
  }

  // Vertical axis cycle: parent HUG + child FILL
  if (parentSizingV === 'HUG' && props.layoutSizingVertical === 'FILL') {
    warnings.push({
      rule: 'ParentChildDependencyCycle',
      nodePath,
      nodeName,
      severity: 'error',
      humanMessage: `CONSTRAINT VIOLATION: FILL child in HUG parent creates circular dependency (vertical axis).`,
      machineReadable: {
        field: 'props.layoutSizingVertical',
        actual: 'FILL',
        expected: 'HUG or FIXED',
        constraint: 'FILL child cannot exist in HUG parent. Change parent to FIXED/FILL, or change child to HUG/FIXED'
      }
    });
  }

  return warnings;
}

/**
 * Rule 3: Auto Layout Requirement for HUG/FILL
 * 
 * Mathematical rule:
 * - HUG sizing requires Auto Layout to measure content
 * - FILL sizing requires Auto Layout to distribute space
 * - Without layout mode, only FIXED sizing is deterministic
 */
function validateAutoLayoutRequirement(
  node: NodeLayer,
  path: string[]
): LintWarning[] {
  const warnings: LintWarning[] = [];
  const props = node.props || {};
  const nodeName = props.name || 'unnamed';
  const nodePath = [...path, nodeName].join(' > ');

  // Only applies to FRAME nodes that can have Auto Layout
  if (node.type !== 'FRAME') return warnings;

  const hasLayout = props.layout && props.layout !== 'NONE';
  const usesHugOrFill = 
    props.layoutSizingHorizontal === 'HUG' || 
    props.layoutSizingHorizontal === 'FILL' ||
    props.layoutSizingVertical === 'HUG' ||
    props.layoutSizingVertical === 'FILL';

  if (!hasLayout && usesHugOrFill) {
    warnings.push({
      rule: 'AutoLayoutRequired',
      nodePath,
      nodeName,
      severity: 'error',
      humanMessage: `CONSTRAINT: HUG/FILL sizing requires Auto Layout. Add layout="VERTICAL" or "HORIZONTAL".`,
      machineReadable: {
        field: 'props.layout',
        actual: props.layout || 'undefined',
        expected: 'VERTICAL or HORIZONTAL',
        constraint: 'HUG/FILL sizing requires Auto Layout. Add layout="VERTICAL" or layout="HORIZONTAL"'
      }
    });
  }

  return warnings;
}

/**
 * Rule 4: FIXED sizing missing dimension
 * 
 * Mathematical rule:
 * - FIXED sizing requires explicit dimension for deterministic layout
 * - Without dimension, the element has undefined size
 */
function validateFixedSizingDimension(
  node: NodeLayer,
  path: string[]
): LintWarning[] {
  const warnings: LintWarning[] = [];
  const props = node.props || {};
  const nodeName = props.name || 'unnamed';
  const nodePath = [...path, nodeName].join(' > ');

  // Only warn for FRAME nodes (TEXT can have intrinsic size)
  if (node.type !== 'FRAME') return warnings;

  if (props.layoutSizingHorizontal === 'FIXED' && props.width === undefined) {
    warnings.push({
      rule: 'FixedSizingMissingDimension',
      nodePath,
      nodeName,
      severity: 'warning',
      humanMessage: `CONSTRAINT: FIXED sizing requires explicit width.`,
      machineReadable: {
        field: 'props.width',
        actual: undefined,
        expected: 'number (e.g., 200)',
        constraint: 'FIXED sizing requires explicit width. Add width value or change to layoutSizingHorizontal="HUG"'
      }
    });
  }

  if (props.layoutSizingVertical === 'FIXED' && props.height === undefined) {
    warnings.push({
      rule: 'FixedSizingMissingDimension',
      nodePath,
      nodeName,
      severity: 'warning',
      humanMessage: `CONSTRAINT: FIXED sizing requires explicit height.`,
      machineReadable: {
        field: 'props.height',
        actual: undefined,
        expected: 'number (e.g., 200)',
        constraint: 'FIXED sizing requires explicit height. Add height value or change to layoutSizingVertical="HUG"'
      }
    });
  }

  return warnings;
}

// ==========================================
// MAIN VALIDATOR
// ==========================================

export interface ConstraintValidationResult {
  /** All constraint warnings found */
  warnings: LintWarning[];
  /** Whether any errors (not just warnings) were found */
  hasErrors: boolean;
  /** Summary for logging */
  summary: string;
}

/**
 * Validate layout constraints for a NodeLayer tree
 * 
 * This performs formal constraint validation, NOT heuristic fixes.
 * Returns warnings that can be fed to Self-Correction Loop.
 * 
 * @param root - Root NodeLayer to validate
 * @returns ConstraintValidationResult with all found issues
 */
export function validateLayoutConstraints(root: NodeLayer): ConstraintValidationResult {
  const allWarnings: LintWarning[] = [];

  // Recursive validation
  function walk(
    node: NodeLayer,
    parentSizingH: string | undefined,
    parentSizingV: string | undefined,
    parentHasLayout: boolean,
    path: string[]
  ): void {
    const props = node.props || {};
    const nodeName = props.name || 'unnamed';

    // Run all constraint rules
    allWarnings.push(
      ...validateSizingDimensionConflict(node, path),
      ...validateParentChildDependency(node, parentSizingH, parentSizingV, parentHasLayout, path),
      ...validateAutoLayoutRequirement(node, path),
      ...validateFixedSizingDimension(node, path)
    );

    // Recurse into children
    if (node.children && Array.isArray(node.children)) {
      const currentHasLayout = props.layout && props.layout !== 'NONE';
      const currentSizingH = props.layoutSizingHorizontal;
      const currentSizingV = props.layoutSizingVertical;

      for (const child of node.children) {
        walk(
          child,
          currentSizingH,
          currentSizingV,
          !!currentHasLayout,
          [...path, nodeName]
        );
      }
    }
  }

  // Start validation from root (no parent context)
  walk(root, undefined, undefined, false, []);

  const errors = allWarnings.filter(w => w.severity === 'error');
  const hasErrors = errors.length > 0;

  return {
    warnings: allWarnings,
    hasErrors,
    summary: `Found ${allWarnings.length} constraint issues (${errors.length} errors, ${allWarnings.length - errors.length} warnings)`
  };
}

/**
 * Format constraint warnings for LLM feedback
 * 
 * Creates a structured prompt section that the LLM can act on.
 */
export function formatConstraintFeedback(result: ConstraintValidationResult): string {
  if (result.warnings.length === 0) {
    return '';
  }

  const lines: string[] = [
    '## Layout Constraint Violations',
    '',
    'The following formal constraints were violated:',
    ''
  ];

  for (const w of result.warnings) {
    const severity = w.severity === 'error' ? '❌ ERROR' : '⚠️ WARNING';
    lines.push(`${severity}: ${w.humanMessage}`);
    lines.push(`   → FIX: ${(w.machineReadable as any)?.constraint || 'N/A'}`);
    lines.push('');
  }

  return lines.join('\n');
}
