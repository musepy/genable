/**
 * @file repositories/index.ts
 * @description Repository layer exports for Figma SDK abstraction
 */

export { NodeRepository, nodeRepository } from './NodeRepository';
export { StorageRepository, storageRepository } from './StorageRepository';
export type { NodeLayoutConfig, NodeStyleConfig } from './NodeRepository';
export type { SettingsData } from './StorageRepository';
