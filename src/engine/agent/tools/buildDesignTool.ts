/**
 * @file buildDesignTool.ts
 * @description Tool definition and executor for the build_design tool.
 *
 * build_design accepts a multi-line instruction text where each line encodes a
 * single design command (create / update / delete / icon / image). The pipeline:
 *   1. tokenizeLines → split instructions into logical lines
 *   2. parseLine    → parse each line into structured ParsedLine
 *   3. ActionCompiler.compile → convert ParsedLines to FigmaActions
 *   4. IncrementalExecutor.execute → run actions one by one with dependency tracking
 */

import { ToolDefinition, ToolExecutor } from './types';
import {
  BuildDesignParams,
  BuildDesignResult,
} from '../../actions/buildDesignTypes';
import { tokenizeLines } from '../../actions/parsing';
import { parseLine } from '../../actions/parsing';
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
  dependencies: ['planDesign'],
  description: `
[BUILD] Execute a multi-line design instruction script in a single call.

Each line of the \`instructions\` parameter is one command. Supported commands:
  create(TYPE, parent=ref, { props })  — Create a new node (FRAME, TEXT, RECTANGLE, ELLIPSE, LINE)
  update(ref, { props })               — Update properties on an existing node
  delete(ref)                          — Remove a node from the document
  icon(parent=ref, { iconName, ... })  — Create an icon from the Iconify library
  image(parent=ref, { width, height }) — Create an image placeholder

Lines beginning with '#' are comments and are ignored.
A line may bind a symbol: \`mySymbol = create(FRAME, ...)\`
Symbols can be referenced in subsequent lines as parent or target.
Aliases: createFrame/createText/createShape → create, setLayout/setStyles/updateProps → update, createIcon → icon, deleteNode → delete.

## CRITICAL SIZING RULE
Figma defaults ALL frames to 100×100px when width/height is omitted.
This is almost NEVER correct. ALWAYS set explicit dimensions or use layoutSizingVertical/layoutSizingHorizontal: "HUG".
Common sizes: Card root 360-480px wide, Input height 44px, Button height 44-48px, Icon 20-24px.
For auto-layout containers: set width explicitly + layoutSizingVertical: "HUG" to hug content height.
For children in auto-layout: use layoutSizingHorizontal: "FILL" to stretch to parent width.

## Example — Simple Card
\`\`\`
card = create(FRAME, { name: "Card", width: 400, layoutSizingVertical: "HUG", layoutMode: "VERTICAL", itemSpacing: 16, padding: 24, fills: ["#FFFFFF"], cornerRadius: 16, effects: [{"type":"DROP_SHADOW","color":"#0000001A","offset":{"x":0,"y":4},"radius":16}] })
title = create(TEXT, parent=card, { characters: "Card Title", fontSize: 20, fontWeight: "Bold", fills: ["#111827"], layoutSizingHorizontal: "FILL" })
desc = create(TEXT, parent=card, { characters: "Description text", fontSize: 14, fills: ["#6B7280"], layoutSizingHorizontal: "FILL" })
\`\`\`

## Example — Login Form (Input, Button, Divider)
\`\`\`
root = create(FRAME, { name: "Login Card", width: 420, layoutSizingVertical: "HUG", layoutMode: "VERTICAL", itemSpacing: 24, padding: 32, fills: ["#FFFFFF"], cornerRadius: 16, effects: [{"type":"DROP_SHADOW","color":"#0000001A","offset":{"x":0,"y":8},"radius":24}] })
heading = create(TEXT, parent=root, { characters: "Sign In", fontSize: 28, fontWeight: "Bold", fills: ["#111827"] })
# Email input
emailWrap = create(FRAME, parent=root, { name: "Email Field", layoutMode: "VERTICAL", itemSpacing: 6, layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" })
emailLabel = create(TEXT, parent=emailWrap, { characters: "Email", fontSize: 14, fontWeight: "Medium", fills: ["#374151"] })
emailInput = create(FRAME, parent=emailWrap, { name: "Email Input", height: 44, layoutSizingHorizontal: "FILL", layoutMode: "HORIZONTAL", padding: 12, fills: ["#F9FAFB"], cornerRadius: 8, strokes: ["#D1D5DB"], strokeWeight: 1 })
emailPlaceholder = create(TEXT, parent=emailInput, { characters: "you@example.com", fontSize: 14, fills: ["#9CA3AF"] })
# Password input
passWrap = create(FRAME, parent=root, { name: "Password Field", layoutMode: "VERTICAL", itemSpacing: 6, layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" })
passLabel = create(TEXT, parent=passWrap, { characters: "Password", fontSize: 14, fontWeight: "Medium", fills: ["#374151"] })
passInput = create(FRAME, parent=passWrap, { name: "Password Input", height: 44, layoutSizingHorizontal: "FILL", layoutMode: "HORIZONTAL", padding: 12, fills: ["#F9FAFB"], cornerRadius: 8, strokes: ["#D1D5DB"], strokeWeight: 1 })
passPlaceholder = create(TEXT, parent=passInput, { characters: "••••••••", fontSize: 14, fills: ["#9CA3AF"] })
# Submit button
submitBtn = create(FRAME, parent=root, { name: "Submit Button", height: 48, layoutSizingHorizontal: "FILL", layoutMode: "HORIZONTAL", primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "CENTER", fills: ["#4F46E5"], cornerRadius: 10 })
submitLabel = create(TEXT, parent=submitBtn, { characters: "Sign In", fontSize: 16, fontWeight: "Bold", fills: ["#FFFFFF"] })
# Divider
divider = create(RECTANGLE, parent=root, { name: "Divider", height: 1, layoutSizingHorizontal: "FILL", fills: ["#E5E7EB"] })
footer = create(TEXT, parent=root, { characters: "Don't have an account? Sign up", fontSize: 14, fills: ["#6B7280"], layoutSizingHorizontal: "FILL" })
\`\`\`

Returns: idMap (symbol → real Figma node ID), lineResults (per-line status), stats.

## IMPORTANT — Handling partial failures

When some lines fail, the result includes idMap with all SUCCESSFUL nodes and lineResults showing exactly which lines failed and why.

DO NOT regenerate the entire design on partial failure. Instead:
1. Read the lineResults to identify which specific lines failed and their error messages.
2. Use the idMap to reference nodes that were successfully created.
3. Call build_design again with ONLY the corrected failed lines, using real Figma IDs from idMap as parent references.
4. If a parent node failed, fix the parent first, then fix its children in a subsequent call.
`,
  parameters: {
    type: 'object',
    properties: {
      instructions: {
        type: 'string',
        description:
          'Multi-line instruction script. Each non-empty, non-comment line is one command. Commands: create, update, delete, icon, image. Lines may assign symbols with "$symbol = command ...".',
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
          'Strategy when a line fails. "continue" (default) skips failed lines and proceeds; "abort" stops execution immediately.',
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
    required: ['instructions'],
  },
  errors: {
    EMPTY_INSTRUCTIONS: 'The instructions parameter must be a non-empty string.',
    PARTIAL_FAILURE: 'Some lines failed during execution.',
    EXECUTION_ERROR: 'An unexpected error occurred in the build_design pipeline.',
  },
};

// ==========================================
// Executor
// ==========================================

/**
 * Full executor for build_design.
 *
 * Pipeline: tokenize → parse → compile → incremental execute.
 */
export const buildDesignExecutor: ToolExecutor<BuildDesignParams, BuildDesignResult> = async (
  params,
  _context
) => {
  const { instructions, parentId, onError = 'continue', rollbackMode = 'none' } = params;

  // --- Input validation ---
  if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
    return {
      success: false,
      error: {
        code: 'EMPTY_INSTRUCTIONS',
        message: 'The instructions parameter must be a non-empty string.',
      },
    };
  }

  try {
    // 1. Tokenize: split instruction text into logical lines
    const tokenizedLines = tokenizeLines(instructions);

    if (tokenizedLines.length === 0) {
      return {
        success: true,
        data: {
          success: true,
          hasErrors: false,
          idMap: {},
          lineResults: [],
          stats: { total: 0, created: 0, failed: 0, skipped: 0, warnings: 0 },
        },
      };
    }

    // 2. Parse: convert each line into a structured ParsedLine
    const parsedLines = tokenizedLines.map(line => parseLine(line));

    // 3. Compile: convert ParsedLines to FigmaActions
    const compiler = new ActionCompiler();
    const { actions, errors } = compiler.compile(parsedLines, parentId);

    // 4. Execute incrementally
    const executor = new IncrementalExecutor();
    const result = await executor.execute(actions, errors, {
      onError,
      rollbackMode,
      parentId,
    });

    // Build detailed error message with per-line failure info
    let errorInfo: { code: string; message: string } | undefined;
    if (result.hasErrors) {
      const failedLines = result.lineResults
        .filter(lr => lr.status === 'failed' || lr.status === 'skipped')
        .slice(0, 10) // cap to keep message reasonable
        .map(lr => {
          const reason = lr.error || lr.skipReason || 'unknown';
          const sym = lr.symbol ? `${lr.symbol} = ` : '';
          const cmd = lr.command || '?';
          return `  L${lr.line} ${sym}${cmd}: ${reason}`;
        });

      const summary = `${result.stats.failed} of ${result.stats.total} lines failed. ${result.stats.created} nodes created successfully.`;
      const details = failedLines.length > 0 ? `\nFailed:\n${failedLines.join('\n')}` : '';
      const overflow = result.lineResults.filter(lr => lr.status === 'failed' || lr.status === 'skipped').length > 10
        ? `\n  ... and ${result.lineResults.filter(lr => lr.status === 'failed' || lr.status === 'skipped').length - 10} more`
        : '';

      errorInfo = {
        code: 'PARTIAL_FAILURE',
        message: `${summary}${details}${overflow}\nUse idMap to reference existing nodes and fix only the failed lines.`,
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
