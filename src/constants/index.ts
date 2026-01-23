/**
 * @file index.ts
 * @description Path: src/constants/index.ts
 * Central export point for all constants.
 */

export * from './featureFlags';
export * from './figma-api';
export * from './layoutRules';
export * from './prompts';

export const LOADING_STEPS = [
  'Understanding design intent...',
  'Architecting component structure...',
  'Applying visual styles...',
  'Refining layout constraints...',
  'Generating Figma layers...'
];
