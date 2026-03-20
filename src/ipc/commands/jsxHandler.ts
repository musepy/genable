/**
 * @file jsxHandler.ts
 * @description Handler for the `jsx` command.
 *
 * Parses JSX-like nested markup → generates flat ops → executeFlatOps().
 * Reuses the entire existing pipeline (normalizer, executor, receipt builder).
 *
 * Syntax:
 *   <frame name="Card" w={400} layout="column" p={24}>
 *     <text name="Title" size={24}>Card Title</text>
 *   </frame>
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { parseJsx } from '../../engine/jsx/jsxParser';
import { jsxToFlatOps } from '../../engine/jsx/jsxToFlatOps';
import { executeFlatOps } from './shared';

export async function handleJsx(parameters: any): Promise<ToolResponse> {
  const { markup, parentId } = parameters;

  if (!markup || typeof markup !== 'string') {
    return {
      success: true,
      data: {
        message: 'jsx — Create design trees with nested JSX-like syntax.',
        usage: 'run({command: "jsx", input: "<frame name=\'Card\' w={400} layout=\'column\' p={24}>\\n  <text name=\'Title\' size={24}>Card Title</text>\\n</frame>"})',
        elements: ['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'instance', 'component', 'group', 'section', 'vector'],
        attributes: 'Same shorthands as mk: w, h, bg, layout, gap, p, corner, fill, size, weight, etc.',
      },
    };
  }

  const { roots, errors } = parseJsx(markup);

  if (roots.length === 0) {
    return {
      success: false,
      error: {
        code: 'PARSE_ERROR',
        message: errors.length > 0
          ? `Parse errors: ${errors.join('; ')}`
          : 'No valid elements found in JSX markup.',
      },
    };
  }

  const flatOps = jsxToFlatOps(roots);
  const result = await executeFlatOps(flatOps, parentId);

  // Attach parse errors as stderr warnings
  if (errors.length > 0) {
    const parseWarnings = errors.map(e => `[warn] ${e}`).join('\n');
    result._stderr = result._stderr
      ? parseWarnings + '\n' + result._stderr
      : parseWarnings;
  }

  return result;
}
