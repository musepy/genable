import { ToolDefinition } from '../types';

/**
 * js — Execute arbitrary JavaScript in the Figma plugin sandbox.
 *
 * The "Bash" of the Figma plugin: full access to figma.* API.
 * Use for operations that structured commands (mk, ls, cat...) can't express:
 * - Conditional queries (findAll with predicates)
 * - Computed layout (read positions → calculate → write)
 * - Batch conditional updates
 * - Component library exploration
 * - Anything the Figma Plugin API supports
 */
export const jsDefinition: ToolDefinition = {
  name: 'js',
  category: 'control',
  display: { displayName: 'JavaScript', group: 'utility' },
  executionStrategy: 'sequential',
  description: `Execute JavaScript code in the Figma plugin runtime.

**Syntax**: \`js <code>\` or \`js\` with input parameter for multiline.

Full access to \`figma\` global (Figma Plugin API). Return a value to see it in the result.

**Examples**:
  js figma.currentPage.children.length
  js figma.currentPage.findAll(n => n.type === 'TEXT').map(n => ({name: n.name, size: n.fontSize}))
  js figma.currentPage.selection.map(n => n.name)

**Multiline** (via input):
  run({command: "js", input: "const cards = figma.currentPage.findAll(n => n.name.includes('Card'))\\ncards.forEach((c,i) => { c.x = i * 420 })\\nreturn cards.length"})

**Available globals**: figma, __uiApi (postMessage to UI thread)
**Async**: awaits the result automatically, so \`await\` works.
**Safety**: read-heavy operations are safe. Write operations modify the canvas — use with intent.`,
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute. Use return to output a value.',
      },
    },
    required: ['code'],
  },
  errors: {
    EXECUTION_ERROR: 'JavaScript execution failed.',
    EMPTY_CODE: 'No code provided.',
  },
};
