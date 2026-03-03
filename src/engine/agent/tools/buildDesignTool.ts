/**
 * @file buildDesignTool.ts
 * @description Tool definition and executor for the build_design tool.
 *
 * build_design accepts a typed JSON array of operations where each element
 * encodes a single design command (create / update / delete / icon / image).
 * The pipeline:
 *   1. operationsToParsedLines → convert operations to ParsedLine[]
 *   2. ActionCompiler.compile   → convert ParsedLines to FigmaActions
 *   3. IncrementalExecutor.execute → run actions one by one with dependency tracking
 */

import { ToolDefinition, ToolExecutor } from './types';
import {
  BuildDesignParams,
  BuildDesignResult,
} from '../../actions/buildDesignTypes';
import { operationsToParsedLines } from '../../actions/operationAdapter';
import { ActionCompiler } from '../../actions/compiler';
import { IncrementalExecutor } from '../../actions/incrementalExecutor';

// ==========================================
// Tool Definition (LLM function-calling schema)
// ==========================================

export const buildDesignDefinition: ToolDefinition = {
  name: 'build_design',
  category: 'create',
  display: { displayName: 'Build Design', group: 'design' },
  executionStrategy: 'sequential',
  idempotent: true,
  dependencies: [],
  description: `
[BUILD] Execute a batch of design operations in a single call.

The \`operations\` parameter is a JSON array where each element is one operation object with an \`op\` field:

  { "op": "create", "symbol": "ref", "type": "FRAME|TEXT|RECTANGLE|ELLIPSE|LINE", "parent": "ref", "props": {...} }
  { "op": "update", "target": "ref", "props": {...} }
  { "op": "delete", "target": "ref" }
  { "op": "icon",   "symbol": "ref", "parent": "ref", "props": { "iconName": "...", ... } }
  { "op": "image",  "symbol": "ref", "parent": "ref", "props": { "width": N, "height": N } }

\`symbol\` binds a name so later operations can reference it as \`parent\` or \`target\`.
\`type\` defaults to "FRAME" if omitted on create.

## CRITICAL SIZING RULE
Figma defaults ALL frames to 100×100px when width/height is omitted.
This is almost NEVER correct. ALWAYS set explicit dimensions or use layoutSizingVertical/layoutSizingHorizontal: "HUG".
Common sizes: Card root 360-480px wide, Input height 44px, Button height 44-48px, Icon 20-24px.
For auto-layout containers: set width explicitly + layoutSizingVertical: "HUG" to hug content height.
For children in auto-layout: use layoutSizingHorizontal: "FILL" to stretch to parent width.

## Example — Simple Card
\`\`\`json
build_design({
  "operations": [
    { "op": "create", "symbol": "card", "type": "FRAME", "props": { "name": "Card", "width": 400, "layoutSizingVertical": "HUG", "layoutMode": "VERTICAL", "itemSpacing": 16, "padding": 24, "fills": ["#FFFFFF"], "cornerRadius": 16, "effects": [{"type":"DROP_SHADOW","color":"#0000001A","offset":{"x":0,"y":4},"radius":16}] } },
    { "op": "create", "symbol": "title", "type": "TEXT", "parent": "card", "props": { "characters": "Card Title", "fontSize": 20, "fontWeight": "Bold", "fills": ["#111827"], "layoutSizingHorizontal": "FILL" } },
    { "op": "create", "symbol": "desc", "type": "TEXT", "parent": "card", "props": { "characters": "Description text", "fontSize": 14, "fills": ["#6B7280"], "layoutSizingHorizontal": "FILL" } }
  ]
})
\`\`\`

## Example — Login Form (Input, Button, Divider)
\`\`\`json
build_design({
  "operations": [
    { "op": "create", "symbol": "root", "type": "FRAME", "props": { "name": "Login Card", "width": 420, "layoutSizingVertical": "HUG", "layoutMode": "VERTICAL", "itemSpacing": 24, "padding": 32, "fills": ["#FFFFFF"], "cornerRadius": 16, "effects": [{"type":"DROP_SHADOW","color":"#0000001A","offset":{"x":0,"y":8},"radius":24}] } },
    { "op": "create", "symbol": "heading", "type": "TEXT", "parent": "root", "props": { "characters": "Sign In", "fontSize": 28, "fontWeight": "Bold", "fills": ["#111827"] } },
    { "op": "create", "symbol": "emailWrap", "type": "FRAME", "parent": "root", "props": { "name": "Email Field", "layoutMode": "VERTICAL", "itemSpacing": 6, "layoutSizingHorizontal": "FILL", "layoutSizingVertical": "HUG" } },
    { "op": "create", "symbol": "emailLabel", "type": "TEXT", "parent": "emailWrap", "props": { "characters": "Email", "fontSize": 14, "fontWeight": "Medium", "fills": ["#374151"] } },
    { "op": "create", "symbol": "emailInput", "type": "FRAME", "parent": "emailWrap", "props": { "name": "Email Input", "height": 44, "layoutSizingHorizontal": "FILL", "layoutMode": "HORIZONTAL", "padding": 12, "fills": ["#F9FAFB"], "cornerRadius": 8, "strokes": ["#D1D5DB"], "strokeWeight": 1 } },
    { "op": "create", "symbol": "emailPlaceholder", "type": "TEXT", "parent": "emailInput", "props": { "characters": "you@example.com", "fontSize": 14, "fills": ["#9CA3AF"] } },
    { "op": "create", "symbol": "passWrap", "type": "FRAME", "parent": "root", "props": { "name": "Password Field", "layoutMode": "VERTICAL", "itemSpacing": 6, "layoutSizingHorizontal": "FILL", "layoutSizingVertical": "HUG" } },
    { "op": "create", "symbol": "passLabel", "type": "TEXT", "parent": "passWrap", "props": { "characters": "Password", "fontSize": 14, "fontWeight": "Medium", "fills": ["#374151"] } },
    { "op": "create", "symbol": "passInput", "type": "FRAME", "parent": "passWrap", "props": { "name": "Password Input", "height": 44, "layoutSizingHorizontal": "FILL", "layoutMode": "HORIZONTAL", "padding": 12, "fills": ["#F9FAFB"], "cornerRadius": 8, "strokes": ["#D1D5DB"], "strokeWeight": 1 } },
    { "op": "create", "symbol": "passPlaceholder", "type": "TEXT", "parent": "passInput", "props": { "characters": "••••••••", "fontSize": 14, "fills": ["#9CA3AF"] } },
    { "op": "create", "symbol": "submitBtn", "type": "FRAME", "parent": "root", "props": { "name": "Submit Button", "height": 48, "layoutSizingHorizontal": "FILL", "layoutMode": "HORIZONTAL", "primaryAxisAlignItems": "CENTER", "counterAxisAlignItems": "CENTER", "fills": ["#4F46E5"], "cornerRadius": 10 } },
    { "op": "create", "symbol": "submitLabel", "type": "TEXT", "parent": "submitBtn", "props": { "characters": "Sign In", "fontSize": 16, "fontWeight": "Bold", "fills": ["#FFFFFF"] } },
    { "op": "create", "symbol": "divider", "type": "RECTANGLE", "parent": "root", "props": { "name": "Divider", "height": 1, "layoutSizingHorizontal": "FILL", "fills": ["#E5E7EB"] } },
    { "op": "create", "symbol": "footer", "type": "TEXT", "parent": "root", "props": { "characters": "Don't have an account? Sign up", "fontSize": 14, "fills": ["#6B7280"], "layoutSizingHorizontal": "FILL" } }
  ]
})
\`\`\`

Returns: idMap (symbol → real Figma node ID), lineResults (per-operation status), stats.

## IMPORTANT — Handling partial failures

When some operations fail, the result includes idMap with all SUCCESSFUL nodes and lineResults showing exactly which operations failed and why.

DO NOT regenerate the entire design on partial failure. Instead:
1. Read the lineResults to identify which specific operations failed and their error messages.
2. Use the idMap to reference nodes that were successfully created.
3. Call build_design again with ONLY the corrected failed operations, using real Figma IDs from idMap as parent references.
4. If a parent node failed, fix the parent first, then fix its children in a subsequent call.
`,
  parameters: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        description:
          'Array of design operations. Each element has an "op" field (create/update/delete/icon/image) plus operation-specific fields.',
        items: {
          type: 'object',
          description: 'A single design operation.',
          properties: {
            op: {
              type: 'string',
              enum: ['create', 'update', 'delete', 'icon', 'image'],
              description: 'Operation type.',
            },
            symbol: {
              type: 'string',
              description: 'Bind a name for later reference as parent/target. Used with create/icon/image.',
            },
            type: {
              type: 'string',
              description: 'Node type for create: FRAME, TEXT, RECTANGLE, ELLIPSE, LINE. Defaults to FRAME.',
            },
            parent: {
              type: 'string',
              description: 'Parent reference: a symbol from an earlier op or a real Figma node ID.',
            },
            target: {
              type: 'string',
              description: 'Target reference for update/delete: a symbol or real Figma node ID.',
            },
            props: {
              type: 'object',
              description: 'Figma node properties (name, fills, width, height, layoutMode, etc.).',
            },
          },
          required: ['op'],
        },
      },
      parentId: {
        type: 'string',
        description:
          'Real Figma node ID to use as the default parent for top-level nodes. If omitted, nodes are added to the current page.',
      },
      onError: {
        type: 'string',
        enum: ['continue', 'abort'],
        description:
          'Strategy when an operation fails. "continue" (default) skips failed operations and proceeds; "abort" stops execution immediately.',
      },
      rollbackMode: {
        type: 'string',
        enum: ['none', 'created_nodes'],
        description:
          'Whether to roll back created nodes when the run is aborted due to failure. "none" (default) keeps partial results; "created_nodes" removes all nodes created in this call.',
      },
      stepId: {
        type: 'string',
        description:
          'Plan step ID. If provided and the call succeeds, the step is automatically marked as completed.',
      },
    },
    required: ['operations'],
  },
  errors: {
    EMPTY_OPERATIONS: 'The operations parameter must be a non-empty array.',
    PARTIAL_FAILURE: 'Some operations failed during execution.',
    EXECUTION_ERROR: 'An unexpected error occurred in the build_design pipeline.',
  },
};

// ==========================================
// Executor
// ==========================================

/**
 * Full executor for build_design.
 *
 * Pipeline: operationsToParsedLines → compile → incremental execute.
 */
export const buildDesignExecutor: ToolExecutor<BuildDesignParams, BuildDesignResult> = async (
  params,
  _context
) => {
  const { operations, parentId, onError = 'continue', rollbackMode = 'none' } = params;

  // --- Input validation ---
  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    return {
      success: false,
      error: {
        code: 'EMPTY_OPERATIONS',
        message: 'The operations parameter must be a non-empty array.',
      },
    };
  }

  try {
    // 1. Convert operations to ParsedLines
    const parsedLines = operationsToParsedLines(operations);

    // 2. Compile: convert ParsedLines to FigmaActions
    const compiler = new ActionCompiler();
    const { actions, errors } = compiler.compile(parsedLines, parentId);

    // 3. Execute incrementally
    const executor = new IncrementalExecutor();
    const result = await executor.execute(actions, errors, {
      onError,
      rollbackMode,
      parentId,
    });

    // Build detailed error message with per-operation failure info
    let errorInfo: { code: string; message: string } | undefined;
    if (result.hasErrors) {
      const failedLines = result.lineResults
        .filter(lr => lr.status === 'failed' || lr.status === 'skipped')
        .slice(0, 10) // cap to keep message reasonable
        .map(lr => {
          const reason = lr.error || lr.skipReason || 'unknown';
          const sym = lr.symbol ? `${lr.symbol} = ` : '';
          const cmd = lr.command || '?';
          return `  #${lr.line} ${sym}${cmd}: ${reason}`;
        });

      const summary = `${result.stats.failed} of ${result.stats.total} operations failed. ${result.stats.created} nodes created successfully.`;
      const details = failedLines.length > 0 ? `\nFailed:\n${failedLines.join('\n')}` : '';
      const overflow = result.lineResults.filter(lr => lr.status === 'failed' || lr.status === 'skipped').length > 10
        ? `\n  ... and ${result.lineResults.filter(lr => lr.status === 'failed' || lr.status === 'skipped').length - 10} more`
        : '';

      errorInfo = {
        code: 'PARTIAL_FAILURE',
        message: `${summary}${details}${overflow}\nUse idMap to reference existing nodes and fix only the failed operations.`,
      };
    }

    return {
      success: result.success,
      data: result,
      error: errorInfo,
    };
  } catch (e: any) {
    return {
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message: e?.message ?? 'Unexpected error in build_design pipeline',
      },
    };
  }
};
