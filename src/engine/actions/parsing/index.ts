/**
 * @file index.ts
 * @description Public API of the parsing module.
 *
 * The parsing pipeline converts a multi-line instruction string (as produced by the
 * LLM for the `build_design` tool) into structured ParsedLine objects:
 *
 *   instructions (string)
 *     → tokenizeLines()   → TokenizedLine[]
 *     → parseLine()       → ParsedLine[]
 *
 * Usage:
 *   import { tokenizeLines, parseLine } from './parsing';
 *
 *   const lines = tokenizeLines(instructions);
 *   const parsed = lines.map(parseLine);
 */

export { tokenizeLines } from './lineTokenizer';
export type { TokenizedLine } from './lineTokenizer';

export { parseLine } from './lineParser';
export type { ParsedLine } from './lineParser';

export { parseProps } from './propsParser';
