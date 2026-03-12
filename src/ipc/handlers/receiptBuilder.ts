/**
 * @file receiptBuilder.ts
 * @description Shared receipt builder for create/edit/design tool results.
 *
 * Consolidates the duplicated receipt-building logic from toolCallHandler.ts
 * into a single function. Also surfaces compiler defaults (sizing, clipsContent)
 * as `defaultsApplied` so the LLM can see what was auto-fixed.
 */

import { LineResult, CreateExecutionResult } from '../../engine/actions/createTypes';
import { ValidationViolation } from '../../engine/validation/postOpValidator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DefaultApplied {
  property: string;   // e.g. "layoutSizingHorizontal"
  value: string;      // e.g. "FILL"
  node: string;       // symbol or nodeId
  reason: string;     // e.g. "child frame without explicit width"
}

export interface ReceiptViolation {
  code: string;       // e.g. "TEXT_OVERFLOW"
  severity: 'warning' | 'error';
  node: string;
  message: string;
  fix?: string;       // optional hint
}

// ---------------------------------------------------------------------------
// Severity mapping for postOpValidator violation codes
// ---------------------------------------------------------------------------

const SEVERITY_MAP: Record<string, 'warning' | 'error'> = {
  ZERO_DIM: 'error',
  INVISIBLE: 'error',
  TEXT_OVERFLOW: 'warning',
  TEXT_WIDTH_COLLAPSED: 'error',
  CHILDREN_OVERFLOW: 'warning',
  SIBLING_WIDTH_MISMATCH: 'warning',
  MISSING_AUTO_LAYOUT: 'warning',
  HUG_FILL_CYCLE: 'error',
  WHITE_ON_WHITE: 'warning',
  SIZING_REVERTED: 'error',
};

const MAX_DEFAULTS_APPLIED = 10;
const MAX_VIOLATIONS = 10;

// ---------------------------------------------------------------------------
// Default extraction helpers
// ---------------------------------------------------------------------------

/** Warning codes that indicate a compiler default was applied. */
const DEFAULT_CODES = new Set([
  'SIZING_DEFAULT',
  'CLIPS_CONTENT_DEFAULT',
]);

/**
 * Extract the property name and value from a compiler default warning message.
 * Messages follow the pattern: `<prop> defaulted to <value> (<reason>).`
 */
function parseDefaultWarning(message: string): { property: string; value: string; reason: string } {
  // e.g. "layoutSizingHorizontal defaulted to \"FILL\" (child frame without explicit width). Set..."
  // e.g. "width defaulted to 360px (root frame without explicit width). Set..."
  // e.g. "clipsContent defaulted to false (auto-layout frame). Set..."
  const match = message.match(/^(\S+) defaulted to [""]?([^""(]+?)[""]?\s*\(([^)]+)\)/);
  if (match) {
    return { property: match[1], value: match[2].trim(), reason: match[3] };
  }
  return { property: 'unknown', value: 'unknown', reason: message };
}

// ---------------------------------------------------------------------------
// Build receipt for create-phase results (IncrementalExecutor output)
// ---------------------------------------------------------------------------

export interface BuildCreateReceiptParams {
  result: CreateExecutionResult;
  violations?: ValidationViolation[];
  softCreateLimit?: number;
  createLineCount?: number;
}

/**
 * Build a compact receipt from IncrementalExecutor results.
 * Used by `create` and the create-phase of `design`.
 */
export function buildCreateReceipt(params: BuildCreateReceiptParams): Record<string, any> {
  const { result, violations, softCreateLimit, createLineCount } = params;
  const receipt: Record<string, any> = {
    idMap: result.idMap,
    created: result.stats.created,
  };
  if (result.stats.edited > 0) receipt.edited = result.stats.edited;
  if (result.stats.deleted > 0) receipt.deleted = result.stats.deleted;

  // Collect errors
  if (result.hasErrors) {
    const failures = result.lineResults
      .filter(lr => lr.status === 'failed')
      .slice(0, 8)
      .map(lr => ({
        op: lr.symbol || `line${lr.line}`,
        error: lr.error || 'unknown',
      }));
    receipt.failed = result.stats.failed;
    if (failures.length > 0) receipt.errors = failures;
  }

  // Collect degraded nodes
  const degradedNodes = result.lineResults
    .filter(lr => lr.warnings?.some(w => w.code === 'DEGRADED_FALLBACK'))
    .map(lr => lr.symbol)
    .filter(Boolean) as string[];
  if (degradedNodes.length > 0) {
    receipt.degraded = degradedNodes;
    receipt.degradedHint = 'These frames were created with minimal props due to errors. Use edit to apply their intended styles (layout, bg, padding, gap, etc).';
  }

  // Defaults applied (compiler auto-fixes)
  const defaultsApplied = extractDefaultsApplied(result.lineResults);
  if (defaultsApplied.length > 0) {
    receipt.defaultsApplied = defaultsApplied.slice(0, MAX_DEFAULTS_APPLIED);
    receipt.defaultsAppliedCount = defaultsApplied.length;
  }

  // Per-node warnings (all non-default warnings, same pattern as buildEditReceipt)
  const allWarnings = result.lineResults
    .filter(lr => lr.warnings && lr.warnings.some(w => !DEFAULT_CODES.has(w.code)))
    .map(lr => ({
      node: lr.symbol || lr.nodeId || `line${lr.line}`,
      warnings: lr.warnings!.filter(w => !DEFAULT_CODES.has(w.code)),
    }));
  if (allWarnings.length > 0) {
    receipt.warnings = allWarnings.slice(0, 15);
    receipt.warningCount = allWarnings.reduce((sum, w) => sum + w.warnings.length, 0);
  }

  if (violations && violations.length > 0) {
    receipt.violations = mapViolations(violations);
  }

  // Soft limit warning
  if (softCreateLimit && createLineCount && createLineCount > softCreateLimit) {
    receipt.nodeLimitWarning = `Created ${createLineCount} nodes in one call (recommended max: ${softCreateLimit}). Large batches increase attribute omission risk. Split into skeleton + per-section calls for better quality.`;
  }

  return receipt;
}

// ---------------------------------------------------------------------------
// Build receipt for edit-phase results (ActionExecutor output)
// ---------------------------------------------------------------------------

export interface BuildEditReceiptParams {
  allResults: Array<{
    success: boolean;
    nodeId?: string;
    error?: string;
    warnings?: Array<{ code: string; message: string }>;
    diffs?: Array<{ key: string; changed: boolean; before?: any; after?: any }>;
  }>;
  violations?: ValidationViolation[];
}

/**
 * Build a compact receipt from edit (update/delete) results.
 * Used by `edit` and the edit-phase of `design`.
 *
 * When diffs are present (from updateProps), the receipt includes:
 *   - `edited`: count of nodes where at least one property actually changed
 *   - `unchanged`: count of nodes where ALL properties were already at target
 *   - `changeSummary`: per-node list of what changed vs what was skipped
 */
export function buildEditReceipt(params: BuildEditReceiptParams): Record<string, any> {
  const { allResults, violations } = params;
  const idMap: Record<string, string> = {};
  for (const r of allResults) {
    if (r.success && r.nodeId) idMap[r.nodeId] = r.nodeId;
  }

  // Compute diff-aware edit counts
  let editedCount = 0;
  let unchangedCount = 0;
  const changeSummary: Array<{ nodeId: string; changed: string[]; unchanged: string[] }> = [];

  for (const r of allResults) {
    if (!r.success) continue;

    if (r.diffs && r.diffs.length > 0) {
      const changed = r.diffs.filter(d => d.changed).map(d => d.key);
      const unchanged = r.diffs.filter(d => !d.changed).map(d => d.key);

      if (changed.length > 0) {
        editedCount++;
        changeSummary.push({
          nodeId: r.nodeId || '?',
          changed,
          unchanged,
        });
      } else {
        unchangedCount++;
      }
    } else {
      // No diffs (create actions, delete, etc.) — count as edited
      editedCount++;
    }
  }

  const receipt: Record<string, any> = { edited: editedCount, idMap };

  // Diff summary — only when there are updates with diffs
  if (unchangedCount > 0) {
    receipt.unchanged = unchangedCount;
    receipt.unchangedHint = `${unchangedCount} node(s) already had the requested values — no changes needed. Focus on nodes that still need fixing.`;
  }
  if (changeSummary.length > 0) {
    receipt.changeSummary = changeSummary.slice(0, 15);
  }

  // Per-node warnings
  const allWarnings = allResults
    .filter(r => r.warnings && r.warnings.length > 0)
    .map(r => ({ nodeId: r.nodeId, warnings: r.warnings }));
  if (allWarnings.length > 0) {
    receipt.warnings = allWarnings.slice(0, 15);
    receipt.warningCount = allWarnings.reduce((sum, w) => sum + w.warnings!.length, 0);
  }

  if (violations && violations.length > 0) {
    receipt.violations = mapViolations(violations);
  }

  // Errors
  const failedResults = allResults.filter(r => !r.success);
  if (failedResults.length > 0) {
    receipt.failed = failedResults.length;
    receipt.errors = failedResults.slice(0, 8).map(r => ({
      op: r.nodeId || '?',
      error: r.error || 'unknown',
    }));
  }

  return receipt;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract `defaultsApplied` entries from LineResult warnings.
 * Only includes warnings whose code ends with `_DEFAULT`.
 */
function extractDefaultsApplied(lineResults: LineResult[]): DefaultApplied[] {
  const defaults: DefaultApplied[] = [];
  for (const lr of lineResults) {
    if (!lr.warnings) continue;
    for (const w of lr.warnings) {
      if (!DEFAULT_CODES.has(w.code)) continue;
      const { property, value, reason } = parseDefaultWarning(w.message);
      defaults.push({
        property,
        value,
        node: lr.symbol || lr.nodeId || `line${lr.line}`,
        reason,
      });
    }
  }
  return defaults;
}

/**
 * Map ValidationViolation[] to ReceiptViolation[] with severity.
 */
function mapViolations(violations: ValidationViolation[]): ReceiptViolation[] {
  return violations.slice(0, MAX_VIOLATIONS).map(v => {
    const violation: ReceiptViolation = {
      code: v.code,
      severity: SEVERITY_MAP[v.code] || 'warning',
      node: v.nodeId,
      message: v.message,
    };
    if (v.hints && v.hints.length > 0) {
      violation.fix = v.hints[0];
    }
    return violation;
  });
}
