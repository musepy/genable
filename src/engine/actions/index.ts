/**
 * @file index.ts
 * @description Barrel export for the actions module.
 */

export {
  clearComponentRegistry,
  getRegisteredSymbols,
  registerComponent,
  applyProps,
  applyTextProps,
  createFrame,
  createText,
  createShape,
  createIcon,
  createComponent,
  createInstance,
  createComponentSet,
  cloneNode,
  updateNode,
  deleteNode,
  tagAsAgentCreated,
  normalizeSizingInProps,
  centerNodeInViewport,
  resolveComponent,
  resolveParent,
  prefetchIcons,
  findExistingChild,
  isAgentOwned,
} from './nodeFactory';

export type { NodeResult, PropResult } from './nodeFactory';
