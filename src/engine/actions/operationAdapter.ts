/**
 * @file operationAdapter.ts
 * @description Converts Operation[] (LLM JSON input) → ParsedLine[] (compiler input).
 *
 * This thin adapter bridges the typed JSON operations from the LLM to the
 * internal ParsedLine format consumed by ActionCompiler and IncrementalExecutor.
 */

import { Operation, ParsedLine } from './buildDesignTypes';

/**
 * Determine which symbols this operation depends on.
 * A reference is a symbol (dependency) if:
 *   - It is not undefined
 *   - It is not the literal string "root"
 *   - It does not look like a real Figma node ID (real IDs contain `:`)
 */
function computeDependsOn(parentRef?: string, targetRef?: string): string[] {
  const deps = new Set<string>();
  for (const ref of [parentRef, targetRef]) {
    if (!ref) continue;
    if (ref === 'root') continue;
    if (ref.includes(':')) continue;
    deps.add(ref);
  }
  return Array.from(deps);
}

/**
 * Convert a typed Operation[] array into ParsedLine[] for ActionCompiler.
 *
 * Each Operation maps directly to a ParsedLine with:
 *   - lineNumber: 1-based index
 *   - raw: JSON summary string (for diagnostics)
 *   - symbol, command, nodeType, parentRef, targetRef, props: from the Operation fields
 *   - dependsOn: auto-computed from parent/target refs
 */
export function operationsToParsedLines(operations: Operation[]): ParsedLine[] {
  return operations.map((op, index): ParsedLine => {
    const lineNumber = index + 1;
    const raw = JSON.stringify(op);

    switch (op.op) {
      case 'create':
        return {
          lineNumber,
          raw,
          symbol: op.symbol,
          command: 'create',
          nodeType: op.type?.toUpperCase() ?? 'FRAME',
          parentRef: op.parent,
          props: op.props,
          dependsOn: computeDependsOn(op.parent),
        };

      case 'update':
        return {
          lineNumber,
          raw,
          command: 'update',
          targetRef: op.target,
          props: op.props,
          dependsOn: computeDependsOn(undefined, op.target),
        };

      case 'delete':
        return {
          lineNumber,
          raw,
          command: 'delete',
          targetRef: op.target,
          dependsOn: computeDependsOn(undefined, op.target),
        };

      case 'icon':
        return {
          lineNumber,
          raw,
          symbol: op.symbol,
          command: 'icon',
          parentRef: op.parent,
          props: op.props,
          dependsOn: computeDependsOn(op.parent),
        };

      case 'image':
        return {
          lineNumber,
          raw,
          symbol: op.symbol,
          command: 'image',
          parentRef: op.parent,
          props: op.props,
          dependsOn: computeDependsOn(op.parent),
        };
    }
  });
}
