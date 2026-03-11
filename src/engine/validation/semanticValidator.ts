/**
 * @file semanticValidator.ts
 * @description Pass 3 of the design pipeline — semantic/domain validation.
 *
 * Validates OperationIR[] after canonicalization (Pass 2) and before
 * lowering to FigmaActions (Pass 4).
 *
 * Checks:
 *   - Text sizing contract (textAutoResize + width/height coherence)
 *   - Auto-layout consistency
 *   - Symbol reference validity
 *
 * Error-severity diagnostics remove the op from the validated list.
 * Warning-severity diagnostics keep the op but report to the caller.
 */

import type { OperationIR } from '../../domain/design-ir';

// ═══════════════════════════════════════════════
// Diagnostic types
// ═══════════════════════════════════════════════

export interface SemanticDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  operationIndex: number;
  symbol?: string;
}

export interface SemanticValidationResult {
  validated: OperationIR[];
  diagnostics: SemanticDiagnostic[];
}

// ═══════════════════════════════════════════════
// Text sizing contract
// ═══════════════════════════════════════════════

type TextAutoResizeMode = 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE' | 'NONE';

const FIXED_WIDTH_MODES = new Set<TextAutoResizeMode>(['HEIGHT', 'TRUNCATE', 'NONE']);

const TEXT_SIZING_KEYS = new Set([
  'w', 'h', 'width', 'height',
  'sizingh', 'sizingv',
  'layoutsizinghorizontal', 'layoutsizingvertical',
  'textautoresize', 'texttruncation', 'maxlines',
]);

function normKey(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, '');
}

function normalizeTextAutoResize(value: unknown): TextAutoResizeMode | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase().replace(/[-\s]+/g, '_');
  switch (normalized) {
    case 'WIDTH_AND_HEIGHT':
    case 'HEIGHT':
    case 'TRUNCATE':
    case 'NONE':
      return normalized;
    default:
      return undefined;
  }
}

function touchesTextSizingContract(props: Record<string, any>): boolean {
  return Object.keys(props).some((key) => TEXT_SIZING_KEYS.has(normKey(key)));
}

function validateTextSizing(
  op: OperationIR,
  index: number,
): SemanticDiagnostic | null {
  const isText = op.nodeType === 'TEXT';
  if (!isText) return null;

  const isCreate = op.command === 'create';
  const props = op.props;

  // For updates, only validate if the update touches sizing-related props
  if (!isCreate && !touchesTextSizingContract(props)) return null;

  const label = op.symbol
    ? `<text ${isCreate ? 'name' : 'id'}="${op.symbol}">`
    : '<text>';

  // Check for unsupported layoutSizing props on text
  const hasUnsupportedSizingProp =
    props.layoutSizingHorizontal !== undefined ||
    props.layoutSizingVertical !== undefined;

  if (hasUnsupportedSizingProp) {
    return {
      code: 'TEXT_SIZING_INVALID',
      severity: 'error',
      message: `${label} cannot use layoutSizingHorizontal/layoutSizingVertical. Use textAutoResize plus numeric width instead.`,
      operationIndex: index,
      symbol: op.symbol,
    };
  }

  const textAutoResize = normalizeTextAutoResize(props.textAutoResize);
  if (props.textAutoResize !== undefined && !textAutoResize) {
    return {
      code: 'TEXT_SIZING_INVALID',
      severity: 'error',
      message: `${label} has invalid textAutoResize="${String(props.textAutoResize)}". Use WIDTH_AND_HEIGHT, HEIGHT, TRUNCATE, or NONE.`,
      operationIndex: index,
      symbol: op.symbol,
    };
  }

  // For creates in design mode, textAutoResize is required
  if (isCreate && !textAutoResize) {
    return {
      code: 'TEXT_SIZING_MISSING',
      severity: 'error',
      message: `${label} must declare textAutoResize explicitly. Use WIDTH_AND_HEIGHT for intrinsic text, or HEIGHT/TRUNCATE/NONE with numeric width.`,
      operationIndex: index,
      symbol: op.symbol,
    };
  }

  if (!textAutoResize) return null;

  const { width, height } = props;
  const hasWidth = width !== undefined;
  const hasHeight = height !== undefined;

  if (hasWidth && (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)) {
    return {
      code: 'TEXT_SIZING_INVALID',
      severity: 'error',
      message: `${label} must use a positive numeric width when width is specified. Text does not support w="fill" or w="hug".`,
      operationIndex: index,
      symbol: op.symbol,
    };
  }

  if (hasHeight && (typeof height !== 'number' || !Number.isFinite(height) || height <= 0)) {
    return {
      code: 'TEXT_SIZING_INVALID',
      severity: 'error',
      message: `${label} must use a positive numeric height when height is specified.`,
      operationIndex: index,
      symbol: op.symbol,
    };
  }

  if (textAutoResize === 'WIDTH_AND_HEIGHT') {
    if (hasWidth || hasHeight) {
      return {
        code: 'TEXT_SIZING_INVALID',
        severity: 'error',
        message: `${label} with textAutoResize="WIDTH_AND_HEIGHT" cannot declare width or height. Let the text size intrinsically.`,
        operationIndex: index,
        symbol: op.symbol,
      };
    }
    return null;
  }

  if (FIXED_WIDTH_MODES.has(textAutoResize) && !hasWidth) {
    return {
      code: 'TEXT_SIZING_INVALID',
      severity: 'error',
      message: `${label} with textAutoResize="${textAutoResize}" must declare a numeric width.`,
      operationIndex: index,
      symbol: op.symbol,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════
// Reference validation
// ═══════════════════════════════════════════════

function validateRefUsage(
  op: OperationIR,
  index: number,
  allSymbols: Set<string>,
): SemanticDiagnostic | null {
  for (const dep of op.dependsOn) {
    if (!allSymbols.has(dep) && !dep.includes(':')) {
      return {
        code: 'REF_NOT_FOUND',
        severity: 'warning',
        message: `Symbol "${dep}" referenced by "${op.symbol ?? 'unnamed'}" not found in this batch.`,
        operationIndex: index,
        symbol: op.symbol,
      };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════
// Main validator
// ═══════════════════════════════════════════════

export interface ValidateSemanticsOptions {
  /** If true, require textAutoResize on create TEXT ops (design mode). Default: false. */
  requireTextAutoResize?: boolean;
}

/**
 * Validate OperationIR[] for semantic/domain correctness.
 *
 * Error-severity diagnostics remove the op from the validated list.
 * Warning-severity diagnostics keep the op.
 */
export function validateSemantics(
  ops: OperationIR[],
  options?: ValidateSemanticsOptions,
): SemanticValidationResult {
  const requireTextAutoResize = options?.requireTextAutoResize ?? false;
  const diagnostics: SemanticDiagnostic[] = [];
  const validated: OperationIR[] = [];

  // Collect all symbols for reference validation
  const allSymbols = new Set<string>();
  for (const op of ops) {
    if (op.symbol) allSymbols.add(op.symbol);
  }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    let hasError = false;

    // Text sizing validation (only when requireTextAutoResize is true)
    if (requireTextAutoResize) {
      const textDiag = validateTextSizing(op, i);
      if (textDiag) {
        diagnostics.push(textDiag);
        if (textDiag.severity === 'error') hasError = true;
      }
    }

    // Reference validation
    const refDiag = validateRefUsage(op, i, allSymbols);
    if (refDiag) {
      diagnostics.push(refDiag);
      if (refDiag.severity === 'error') hasError = true;
    }

    if (!hasError) {
      validated.push(op);
    }
  }

  return { validated, diagnostics };
}
