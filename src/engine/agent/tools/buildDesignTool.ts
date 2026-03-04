/**
 * @file buildDesignTool.ts
 * @description Tool definition and executor for the create tool.
 *
 * create accepts XML design markup and converts it to Figma nodes.
 * The pipeline:
 *   1. xmlToParsedLines → parse XML into ParsedLine[]
 *   2. ActionCompiler.compile   → convert ParsedLines to FigmaActions
 *   3. IncrementalExecutor.execute → run actions one by one with dependency tracking
 */

import { ToolDefinition, ToolExecutor } from './types';
import {
  BuildDesignParams as CreateParams,
  BuildDesignResult,
} from '../../actions/buildDesignTypes';
import { ActionCompiler } from '../../actions/compiler';
import { IncrementalExecutor } from '../../actions/incrementalExecutor';
import { xmlToParsedLines } from '../../actions/xmlDesignParser';

/** @deprecated Use CreateParams instead */
export type BuildDesignParams = CreateParams;

// ==========================================
// Tool Definition (LLM function-calling schema)
// ==========================================

export const buildDesignDefinition: ToolDefinition = {
  name: 'create',
  category: 'create',
  display: { displayName: 'Create', group: 'design' },
  executionStrategy: 'sequential',
  idempotent: true,
  dependencies: [],
  description: `
Create new design nodes from XML markup in a single call.

Tags: frame, text, rect, ellipse, line, icon, image, group, section, vector
Nesting = parent-child. Text content = characters. Use single quotes for attributes.

Attributes accept CSS names (layout, gap, background, borderRadius), read-path abbreviations (w, h, size, weight, corner, p, bg), and Figma-native names.

Shorthands:
- \`p="16"\` → uniform padding; \`p="16 24"\` → V H; \`p="10 20 30 40"\` → T R B L
- \`shadow="0,4,16,0,#0000001A"\` → DROP_SHADOW; \`inset,...\` → INNER_SHADOW; \`;\` for multiple
- \`fill="#FFF"\` / \`fills="#A,#B"\` → fills array
- \`stroke="#D1D5DB"\` → strokes array

\`\`\`json
create({
  "xml": "<frame name='Card' layout='column' gap='16' p='24' w='400' height='hug' bg='#FFFFFF' corner='16' shadow='0,4,16,0,#0000001A'><text name='Title' size='20' weight='Bold' fill='#111827' width='fill'>Card Title</text><text name='Desc' size='14' fill='#6B7280' width='fill'>Description text</text></frame>"
})
\`\`\`

## CRITICAL SIZING RULE
Frames default to 100×100px when width/height is omitted — almost NEVER correct.
ALWAYS set explicit dimensions or use height="hug" / width="fill".
Common sizes: Card root 360-480px wide, Input height 44px, Button height 44-48px, Icon 20-24px.

Returns: idMap (symbol → real Figma node ID), lineResults (per-operation status), stats.

## Handling partial failures

DO NOT regenerate the entire design on partial failure. Instead:
1. Read the lineResults to identify which specific operations failed and their error messages.
2. Use the idMap to reference nodes that were successfully created.
3. Call create again with ONLY the corrected failed operations, using real Figma IDs from idMap as parent references.
`,
  parameters: {
    type: 'object',
    properties: {
      xml: {
        type: 'string',
        description:
          'XML design markup. Tags: frame, text, rect, ellipse, line, icon, image, group, section, vector. Nesting = parent-child. Text content = characters. Use single quotes.',
      },
      parentId: {
        type: 'string',
        description:
          'Real Figma node ID to use as the default parent for top-level nodes. If omitted, nodes are added to the current page.',
      },
    },
    required: ['xml'],
  },
  errors: {
    EMPTY_XML: 'A non-empty "xml" string must be provided.',
    XML_PARSE_ERROR: 'Failed to parse the XML design markup.',
    PARTIAL_FAILURE: 'Some operations failed during execution.',
    EXECUTION_ERROR: 'An unexpected error occurred in the create pipeline.',
  },
};

// ==========================================
// Executor
// ==========================================

/**
 * Full executor for create.
 *
 * Pipeline: xmlToParsedLines → compile → incremental execute.
 */
export const buildDesignExecutor: ToolExecutor<CreateParams, BuildDesignResult> = async (
  params,
  _context
) => {
  const { xml, parentId } = params;
  const onError = 'continue';
  const rollbackMode = 'none';

  // --- Input validation ---
  if (!xml || typeof xml !== 'string' || xml.trim().length === 0) {
    return {
      success: false,
      error: {
        code: 'EMPTY_XML',
        message: 'A non-empty "xml" string must be provided.',
      },
    };
  }

  let parsedLines;
  try {
    parsedLines = xmlToParsedLines(xml);
  } catch (e: any) {
    return {
      success: false,
      error: { code: 'XML_PARSE_ERROR', message: e.message },
    };
  }

  try {

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
        message: e?.message ?? 'Unexpected error in create pipeline',
      },
    };
  }
};
