// [P8] TokenRegistry defined locally to decouple from archived service
export interface ComponentVariant {
    height?: number;
    width?: number;
    paddingH?: number;
    padding?: number;
    radius?: number;
    fontSize?: number;
    strokeWeight?: number;
    marginLeft?: number;
    marginRight?: number;
}

export interface TypographyToken {
    fontSize: number;
    lineHeight: number;
    fontWeight: number;
}

export interface ElevationToken {
    blur: number;
    y: number;
    opacity: number;
}

export interface TokenRegistry {
    name: string;
    version: string;
    components: Record<string, Record<string, ComponentVariant>>;
    spacing: Record<string, number>;
    radius: Record<string, number>;
    typography: {
        fontFamily?: string;
        weights?: Record<string, string>;
        supportedStyles?: string[];
        preloadStyles?: string[];
        semantic?: Record<string, any>;
        [key: string]: TypographyToken | string | Record<string, string> | string[] | Record<string, any> | undefined;
    };
    elevation?: Record<string, ElevationToken | null>;
    cornerSmoothing?: number;
    colorRoles?: Record<string, string>;
    semanticFallbacks?: Record<string, string>;
}

/**
 * Unified Design System Configuration
 * This acts as the Single Source of Truth (SSOT) for all aspects of a design system.
 */
export interface Viewport {
    width: number;
    height: number;
}

export interface DesignSystemManifest {
    name: string;
    id: string;
    version: string;
    description?: string;
    viewport: Record<string, Viewport>;
    defaultViewport: string;
    defaultVariant: string;
    cornerSmoothing?: number;
    tokensFile?: string;
    constraintsFile?: string;
    promptFile?: string;
}

export interface SemanticConstraint {
    hMin?: number;
    hMax?: number;
    hDefault?: number;
    hFixed?: number;
    wMin?: number;
    wMax?: number;
    wDefault?: number;
    wFixed?: number;
    aspectRatio?: number;
    layoutSizingHorizontal?: 'FILL' | 'HUG' | 'FIXED';
    layoutSizingVertical?: 'FILL' | 'HUG' | 'FIXED';
    paddingMin?: number;
    paddingHorizontal?: number;
    gapDefault?: number;
    cornerRadius?: number;
    priority?: number;
    variants?: Record<string, { height?: number; width?: number }>;
}

export interface DesignSystemConstraints {
    $schema?: string;
    description?: string;
    constraints: Record<string, SemanticConstraint>;
}

export interface DesignSystemHeuristics {
    heuristics: {
        appearance: {
            darkLuminanceThreshold: number;
            subtleShadowOpacity: string;
            defaultShadowColor: string;
        };
        text: {
            paragraphMinLength: number;
            longTextThreshold: number;
        };
        layout: {
            defaultCardPadding: number;
            defaultCardRadius: number;
            defaultButtonHeight: number;
            containerWidth: number;
            smallComponentWidth: number;
            wideComponentWidth: number;
            emptyHeight: number;
        };
        scoring: {
            standardSpacing: number[];
            standardRadii: number[];
        };
    };
}

export interface DesignSystemPatterns {
    patterns: {
        COMPONENT_IDENTIFIERS: Record<string, string>;
        NAMING_PATTERNS: Record<string, string[]>;
        INTENT_KEYWORDS?: {
            targets: Record<string, string[]>;
            modifiers: Record<string, string[]>;
        };
    };
}

export interface DesignSystemAliases {
    aliases: Record<string, string>;
}

export interface DesignSystemConfig {
    manifest: DesignSystemManifest;
    constraints: DesignSystemConstraints;
    tokens?: TokenRegistry;
    heuristics: DesignSystemHeuristics;
    patterns: DesignSystemPatterns;
    aliases: DesignSystemAliases;
    promptSnippet: string;
}

export type DesignSystemId = 'material3' | 'shadcn' | 'ios-hig' | 'custom' | 'vanilla';
