/**
 * @file index.ts
 * @description Layout primitives barrel export
 * 
 * Layout primitives following 隔离式UI开发工作流:
 * - Stack: Vertical flex layout (column)
 * - Flex: Horizontal flex layout (row)
 * - Iso: Isolation wrapper for style containment
 */

export { Stack, type StackGap, type StackAlign } from './Stack';
export { Flex, type FlexGap, type FlexAlign, type FlexJustify } from './Flex';
export { Iso } from './Iso';
