/**
 * @file semanticValidator.ts
 * @description Pass 3 of the design pipeline — semantic/domain validation.
 *
 * Validates OperationIR[] after canonicalization (Pass 2) and before
 * lowering to FigmaActions (Pass 4).
 *
 * Checks:
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
  // Reserved for future validation options.
}

/**
 * Validate OperationIR[] for semantic/domain correctness.
 *
 * Error-severity diagnostics remove the op from the validated list.
 * Warning-severity diagnostics keep the op.
 */
export function validateSemantics(
  ops: OperationIR[],
  _options?: ValidateSemanticsOptions,
): SemanticValidationResult {
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
