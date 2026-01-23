/**
 * @file engineConfig.ts
 * @description Baseline engine configuration for the Figma AI Generator
 */

import { DesignSystemConfig } from '../types/designSystem';

export const VANILLA_CONFIG: DesignSystemConfig = {
    manifest: {
        name: 'Vanilla Engine',
        id: 'vanilla',
        version: '1.0.0',
        viewport: { 'DESKTOP': { width: 1440, height: 1024 } },
        defaultViewport: 'DESKTOP',
        defaultVariant: 'DEFAULT'
    },
    constraints: { constraints: {} },
    tokens: {
        name: 'Vanilla Tokens',
        version: '1.0.0',
        components: {},
        spacing: {},
        radius: {},
        typography: {},
        colorRoles: {}
    },
    heuristics: { 
        heuristics: { 
            appearance: { darkLuminanceThreshold: 0.5, subtleShadowOpacity: '0', defaultShadowColor: 'transparent' },
            text: { paragraphMinLength: 9999, longTextThreshold: 9999 },
            layout: { defaultCardPadding: 0, defaultCardRadius: 0, defaultButtonHeight: 0, containerWidth: 1440, smallComponentWidth: 0, wideComponentWidth: 0, emptyHeight: 0 },
            scoring: { standardSpacing: [], standardRadii: [] }
        }
    },
    patterns: { patterns: { COMPONENT_IDENTIFIERS: {}, NAMING_PATTERNS: {} } },
    aliases: { aliases: {} },
    promptSnippet: ''
};

export function getActiveEngineConfig(_id?: string): DesignSystemConfig {
    // Currently only supporting vanilla as the baseline engine config.
    // Design systems are now handled via RAG in KnowledgeHub.
    return VANILLA_CONFIG;
}
