/**
 * @file ir-adapter.ts
 * @description Thin adapter: OperationIR[] → ParsedLine[] for ActionCompiler compatibility.
 *
 * OperationIR and ParsedLine are structurally identical except for
 * `lineNumber`/`raw` diagnostic fields which ParsedLine requires.
 */

import type { OperationIR } from '../../domain/design-ir';
import type { ParsedLine } from '../actions/createTypes';

/**
 * Convert OperationIR[] to ParsedLine[] for ActionCompiler consumption.
 * Adds synthetic `lineNumber` and `raw` fields for diagnostics.
 */
export function operationsToParsedLines(operations: OperationIR[]): ParsedLine[] {
  return operations.map((op, i) => ({
    lineNumber: i + 1,
    raw: JSON.stringify({ command: op.command, symbol: op.symbol }),
    symbol: op.symbol,
    command: op.command,
    nodeType: op.nodeType,
    targetRef: op.targetRef,
    parentRef: op.parentRef,
    props: op.props,
    dependsOn: op.dependsOn,
    reusable: op.reusable,
    componentRef: op.componentRef,
    overrides: op.overrides,
  }));
}
