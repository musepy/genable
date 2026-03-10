/**
 * @file createTool.ts
 * @description Tool definition and executor for the create tool.
 *
 * create accepts XML design markup and converts it to Figma nodes.
 * The pipeline:
 *   1. parseXml → XmlNode[]  +  interpretXmlNodes → OperationIR[]
 *   2. ActionCompiler.compile   → convert to FigmaActions
 *   3. IncrementalExecutor.execute → run actions one by one with dependency tracking
 */

import { ToolDefinition, ToolExecutor } from './types';
import { CreateParams } from '../../actions/createTypes';
import { ActionCompiler } from '../../actions/compiler';
import { IncrementalExecutor } from '../../actions/incrementalExecutor';
import { parseXml } from '../../actions/xmlDesignParser';
import { interpretXmlNodes } from '../../xml/xml-interpreter';
import { buildCreateReceipt } from '../../../ipc/handlers/receiptBuilder';

// ==========================================
// Tool Definition (LLM function-calling schema)
// ==========================================

export const createDefinition: ToolDefinition = {
  name: 'create',
  category: 'create',
  display: { displayName: 'Create', group: 'design' },
  executionStrategy: 'sequential',
  idempotent: true,
  dependencies: [],
  description: `
Create new design nodes from XML markup in a single call.

Tags: frame, text, rect, ellipse, line, icon, image, group, section, vector, ref
Nesting = parent-child. Text content = characters. Use single quotes for attributes.
Use \`<ref component='Name' set:child='text'/>\` to instantiate reusable components.

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

Returns: compact receipt with idMap, created/failed counts, errors for failed ops,
defaultsApplied for compiler auto-fixes, and violations if post-op validation flags issues.

## Reusable Components
Use \`reusable='true'\` on a \`<frame>\` to create a Figma Component (not just a frame).
Use \`<ref component='Name'>\` to create instances of that component.
Use \`set:childName='text'\` on \`<ref>\` to override text content in instances.

Example: \`<frame name='Card' reusable='true' ...>...</frame>\` then \`<ref component='Card' set:title='Hello'/>\`

## Handling partial failures

DO NOT regenerate the entire design on partial failure. Instead:
1. Check the errors array to identify which specific operations failed.
2. Use the idMap to reference nodes that were successfully created.
3. Call create again with ONLY the corrected failed operations, using real Figma IDs from idMap as parent references.
`,
  parameters: {
    type: 'object',
    properties: {
      xml: {
        type: 'string',
        description:
          'XML design markup. Tags: frame, text, rect, ellipse, line, icon, image, group, section, vector, ref. Nesting = parent-child. Text content = characters. Use single quotes. Use reusable=true on frame for components, <ref component=Name/> for instances.',
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
 * Pipeline: parseXml → interpretXmlNodes → compile → incremental execute → compact receipt.
 */
export const createExecutor: ToolExecutor<CreateParams> = async (
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
    const xmlNodes = parseXml(xml);
    parsedLines = interpretXmlNodes(xmlNodes, { mode: 'create' });
  } catch (e: any) {
    return {
      success: false,
      error: { code: 'XML_PARSE_ERROR', message: e.message },
    };
  }

  try {
    const compiler = new ActionCompiler();
    const { actions, errors } = compiler.compile(parsedLines, parentId);

    const executor = new IncrementalExecutor();
    const result = await executor.execute(actions, errors, {
      onError,
      rollbackMode,
      parentId,
    });

    let errorInfo: { code: string; message: string } | undefined;
    if (result.hasErrors) {
      errorInfo = {
        code: 'PARTIAL_FAILURE',
        message: `${result.stats.failed} of ${result.stats.total} failed. ${result.stats.created} created. Use idMap to fix only the failed operations.`,
      };
    }
    const receipt = buildCreateReceipt({
      result,
      violations: Array.isArray((result as any).violations) ? (result as any).violations : undefined,
    });

    return {
      success: result.success,
      data: receipt,
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
