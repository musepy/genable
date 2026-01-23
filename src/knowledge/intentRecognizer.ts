/**
 * Intent Recognizer
 * Understands user intent from prompt and selection context
 */


// To avoid circular dependency with 'types.ts' (which might import this), we'll define minimal interfaces or rely on loose coupling.

// ============================================
// Types
// ============================================

export interface Fill {
    type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'IMAGE' | 'VIDEO';
    color?: { r: number; g: number; b: number; a?: number };
    opacity?: number;
    visible?: boolean;
}

export interface FigmaNodeBasic {
    id: string;
    name: string;
    type: string;
    width?: number;
    height?: number;
    fills?: Fill[];
    cornerRadius?: number;
    fontSize?: number;
    fontWeight?: string;
    strokeWeight?: number;
    strokes?: unknown[];
    effects?: { type: string }[];
    characters?: string;
    content?: string;
}

export interface SelectionNode {
    id: string;
    name: string;
    type: 'FRAME' | 'TEXT' | 'RECTANGLE' | 'GROUP' | 'COMPONENT' | 'INSTANCE' | string;
    content?: string;  // For TEXT nodes
    width?: number;
    height?: number;
    fills?: Fill[];
    // Enhanced style properties
    cornerRadius?: number;
    fontSize?: number;
    fontWeight?: string;
    strokeWeight?: number;
}

export interface StyleFeatures {
    dominantColors: string[];      // Extracted fill colors
    cornerRadii: number[];         // Unique corner radius values
    fontSizes: number[];           // Unique font sizes
    fontWeights: string[];         // Font weights used
    spacing: number[];             // Detected gap/padding values
    hasStroke: boolean;            // Any element has stroke
    hasShadow: boolean;            // Any element has drop shadow
}

export interface SelectionContext {
    nodes: SelectionNode[];
    count: number;
    primaryType: string;  // Most common node type
    hasText: boolean;
    textContents: string[];  // All text contents
    relationship: {
        isHorizontalRow: boolean;
        isVerticalColumn: boolean;
        hasSimilarSiblings: boolean;
        isCollection: boolean; // New: Detect if it's a list/grid of similar items
    };
    // NEW: Enhanced style analysis
    styleFeatures: StyleFeatures;
    // NEW: Inferred component type
    inferredComponent: null;  // Heuristic inference removed. RELY ON LLM.
}

export type IntentType =
    | 'CONVERT_COMPONENT' // Unified from CONVERT_TO_TAG/BUTTON
    | 'APPLY_STYLE'
    | 'GENERATE_COMPONENT'
    | 'MODIFY_EXISTING'
    | 'UNKNOWN';

export interface RecognizedIntent {
    type: IntentType;
    confidence: number;  // 0-1
    target?: string;     // e.g. "Badge", "Button", "Card"
    modifiers: {
        variant?: string;   // e.g. "outline", "ghost"
        semantic?: string;  // e.g. "destructive", "success"
        size?: string;      // e.g. "sm", "lg"
        shape?: string;     // e.g. "pill", "rounded"
        rawAdjectives?: string[]; // Captured adjectives not yet mapped
    };
    matchedKeywords: string[];
    /** UI Pro Max reasoning hints from semantic search */
    reasoningHints?: ReasoningRule;
}

// ============================================
// Keyword Patterns (Loaded from JSON configuration)
// ============================================

// Patterns are passed explicitly
import { DesignSystemPatterns } from '../types/designSystem'; 
import { knowledgeHub, ReasoningRule } from '../engine/llm-client/knowledge/knowledgeHub';

// ============================================
// Recognition Functions
// ============================================

/**
 * Recognize user intent from prompt
 */
export function recognizeIntent(
    prompt: string,
    selectionContext?: SelectionContext,
    patterns?: DesignSystemPatterns
): RecognizedIntent {
    const promptLower = prompt.toLowerCase();
    
    // Patterns are now passed from the caller (Nexus-aware)
    const TARGET_MAP = patterns?.patterns?.INTENT_KEYWORDS?.targets || {};
    // const MODIFIER_MAP access moved to extractModifiers

    // 1. Detect Component Target
    let bestTarget = '';
    let targetScore = 0;

    for (const [target, keywords] of Object.entries(TARGET_MAP)) {
        if ((keywords as string[]).some(k => promptLower.includes(k))) {
            bestTarget = target;
            targetScore = 1; // Direct match
            break;
        }
    }


    // 2. Detect Intent Type based on verbs/context
    let type: IntentType = 'UNKNOWN';
    let confidence = 0;

    // "Convert" logic: Has selection + target keyword
    // "Convert" logic: Has selection + target keyword
    if (selectionContext && selectionContext.count > 0 && bestTarget) {
        type = 'CONVERT_COMPONENT';
        confidence = 1.0;
    }
    // "Generate" logic: No selection (or ignored) + "create/make" + target
    else if (bestTarget && (promptLower.includes('create') || promptLower.includes('make') || promptLower.includes('generate') || promptLower.includes('创建') || promptLower.includes('生成'))) {
        type = 'GENERATE_COMPONENT';
        confidence = 1.0;
    }
    // "Modify" logic: Has selection + "change/update"
    else if (selectionContext && selectionContext.count > 0 && (promptLower.includes('change') || promptLower.includes('modify') || promptLower.includes('update') || promptLower.includes('修改'))) {
        type = 'MODIFY_EXISTING';
        confidence = 1.0;
    }
    // "Apply Style" logic
    else if (selectionContext && selectionContext.count > 0 && (promptLower.includes('style') || promptLower.includes('color') || promptLower.includes('font'))) {
        type = 'APPLY_STYLE';
        confidence = 1.0;
    }

    if (type === 'UNKNOWN' && bestTarget) {
        // Fallback: If target is mentioned ("card"), assume generate if no selection, or convert if selection exists
        if (selectionContext && selectionContext.count > 0) {
            type = 'CONVERT_COMPONENT';
            confidence = 1.0;
        } else {
            type = 'GENERATE_COMPONENT';
            confidence = 1.0;
        }
    }

    // 3. Extract Modifiers
    const modifiers = extractModifiers(promptLower, patterns);

    // 4. Search UI Pro Max reasoning knowledge base
    const reasoningResults = knowledgeHub.searchReasoning(prompt, 1);
    const reasoningHints = reasoningResults.length > 0 ? reasoningResults[0].item : undefined;

    return {
        type,
        confidence,
        target: bestTarget || undefined,
        modifiers,
        matchedKeywords: [],
        reasoningHints
    };
}

/**
 * Extract style/variant modifiers from text
 */
function extractModifiers(text: string, patterns?: DesignSystemPatterns) {
    const result: RecognizedIntent['modifiers'] = {};
    const MODIFIER_MAP = patterns?.patterns?.INTENT_KEYWORDS?.modifiers || {};

    for (const [modKey, keywords] of Object.entries(MODIFIER_MAP)) {
        const matchedKeyword = (keywords as string[]).find(k => text.includes(k));
        
        if (matchedKeyword) {
            // Dynamic assignment based on category mapping in DesignSystemPatterns if available,
            // otherwise use a simple fallback or add to a generic list.
            // For now, we trust the LLM to understand the modifier's semantic meaning.
            // We just capture it.

            // If we really need to categorize, we should do it via the Patterns config, not hardcoded here.
            // Assuming the keys in INTENT_KEYWORDS.modifiers are the categories themselves:
            // e.g. "size": ["sm", "lg"], "variant": ["outline", "ghost"]
            
            // However, the current signature of result expects specific keys. 
            // We'll map dynamically if the modKey matches the result keys.
            if (modKey === 'size') result.size = matchedKeyword;
            else if (modKey === 'shape') result.shape = matchedKeyword;
            else if (modKey === 'semantic') result.semantic = matchedKeyword;
            else if (modKey === 'variant') result.variant = matchedKeyword;
            else {
                 // If it's a specific named modifier group (e.g. 'destructive' as a key), handle that?
                 // The previous code had inverted logic (checking values to assign keys).
                 // Correct approach: The keys of the map ARE the categories.
                 // So if modKey is 'size', and we found 'sm', then result.size = 'sm' (or the matched keyword).
                 
                 // Fallback for existing structure if the map keys are "sm", "lg" etc directly (which is bad data design but possible)
                 // But typically DesignSystemPatterns keys should be the CATEGORY.
                 
                 if (!result.variant) result.variant = matchedKeyword; // Default bucket
            }
        }
    }
    return result;
}

/**
 * Build selection context from Figma selection data
 */
export function buildSelectionContext(selectionNodes: FigmaNodeBasic[]): SelectionContext {
    const emptyStyleFeatures: StyleFeatures = {
        dominantColors: [],
        cornerRadii: [],
        fontSizes: [],
        fontWeights: [],
        spacing: [],
        hasStroke: false,
        hasShadow: false
    };

    if (!selectionNodes || selectionNodes.length === 0) {
        return {
            nodes: [],
            count: 0,
            primaryType: 'NONE',
            hasText: false,
            textContents: [],
            relationship: {
                isHorizontalRow: false,
                isVerticalColumn: false,
                hasSimilarSiblings: false,
                isCollection: false
            },
            styleFeatures: emptyStyleFeatures,
            inferredComponent: null
        };
    }

    // Extract enhanced node properties
    const nodes: SelectionNode[] = selectionNodes.map(node => ({
        id: node.id,
        name: node.name || '',
        type: node.type || 'UNKNOWN',
        content: node.characters || node.content,
        width: node.width,
        height: node.height,
        fills: node.fills,
        cornerRadius: node.cornerRadius,
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        strokeWeight: node.strokeWeight
    }));

    // Find primary type
    const typeCounts: Record<string, number> = {};
    nodes.forEach(n => {
        typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
    });
    const primaryType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';

    // Check for text
    const hasText = nodes.some(n => n.type === 'TEXT');
    const textContents = nodes
        .filter(n => n.type === 'TEXT' && n.content)
        .map(n => n.content!);

    // ==========================================
    // NEW: Extract Style Features
    // ==========================================
    const colors: string[] = [];
    const radii: number[] = [];
    const fontSizes: number[] = [];
    const fontWeights: string[] = [];
    let hasStroke = false;
    let hasShadow = false;

    for (const node of selectionNodes) {
        // Extract colors from fills
        if (node.fills && Array.isArray(node.fills)) {
            for (const fill of node.fills) {
                if (fill.type === 'SOLID' && fill.color) {
                    const hex = rgbToHex(fill.color);
                    if (hex && !colors.includes(hex)) colors.push(hex);
                }
            }
        }

        // Extract corner radius
        if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
            if (!radii.includes(node.cornerRadius)) radii.push(node.cornerRadius);
        }

        // Extract font info from text nodes
        if (node.type === 'TEXT') {
            if (typeof node.fontSize === 'number' && !fontSizes.includes(node.fontSize)) {
                fontSizes.push(node.fontSize);
            }
            if (node.fontWeight && !fontWeights.includes(node.fontWeight)) {
                fontWeights.push(node.fontWeight);
            }
        }

        // Check for strokes
        if (node.strokes && Array.isArray(node.strokes) && node.strokes.length > 0) {
            hasStroke = true;
        }
        if (typeof node.strokeWeight === 'number' && node.strokeWeight > 0) {
            hasStroke = true;
        }

        // Check for shadows
        if (node.effects && Array.isArray(node.effects)) {
            hasShadow = node.effects.some((e: { type: string }) =>
                e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'
            );
        }
    }

    const styleFeatures: StyleFeatures = {
        dominantColors: colors.slice(0, 5), // Limit to 5 colors
        cornerRadii: radii.sort((a, b) => a - b),
        fontSizes: fontSizes.sort((a, b) => a - b),
        fontWeights,
        spacing: [], // TODO: Extract from padding/gap if available
        hasStroke,
        hasShadow
    };

    // ==========================================
    // NEW: Infer Component Type
    // ==========================================
    const inferredComponent = null; // Removed heuristic inference

    // Analyze relationship
    let isHorizontalRow = false;
    let isVerticalColumn = false;

    // Simple 1D layout detection (basic heuristic)
    if (nodes.length > 1) {
        // If all nodes have similar Y, likely horizontal
        // If all nodes have similar X, likely vertical
        // Placeholder for future spatial analysis
    }

    // Heuristic: Collection = Multiple items of same type
    const isCollection = nodes.length > 1 && (typeCounts[primaryType] / nodes.length > 0.8);

    return {
        nodes,
        count: nodes.length,
        primaryType,
        hasText,
        textContents,
        relationship: {
            isHorizontalRow,
            isVerticalColumn,
            hasSimilarSiblings: isCollection,
            isCollection
        },
        styleFeatures,
        inferredComponent
    };
}

/**
 * Convert RGB object to hex string
 */
function rgbToHex(color: { r: number; g: number; b: number }): string {
    if (!color) return '';
    const toHex = (n: number) => {
        const hex = Math.round(n * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`.toUpperCase();
}

/**
 * Infer component type from node properties and content
 */
/**
 * inferComponentType REMOVED
 * We now rely on the LLM to inspect the node structure and properties directly
 * rather than using fragile geometric heuristics.
 */

/**
 * @deprecated Legacy support. 
 * Generate enhanced prompt based on intent. 
 * This logic is moving to contextBuilder.ts (Phase 3)
 */
export function enhancePromptWithIntent(
    originalPrompt: string,
    intent: RecognizedIntent,
    selectionContext?: SelectionContext
): string {
    // Basic passthrough for now, as we'll handle Prompt assembly in contextBuilder
    return originalPrompt;
}

// ==========================================
// Decision Tree Routing (Skills Integration)
// ==========================================

/**
 * Decision Tree Route - determines processing path based on intent and context
 * 
 * User prompt → Is selection provided?
 *     ├─ Yes → Is it a text node?
 *     │         ├─ Yes → CONVERT_TEXT mode (Level 1 context)
 *     │         └─ No → Is it a container?
 *     │             ├─ Yes → MODIFY_LAYOUT mode (Level 2 context)
 *     │             └─ No → STYLE_CHANGE mode (Level 1 context)
 *     └─ No → Is prompt about a component?
 *         ├─ Yes → GENERATE_COMPONENT mode (Level 2 context)
 *         └─ No → Is prompt about a page/layout?
 *             ├─ Yes → GENERATE_PAGE mode (Level 3 context)
 *             └─ No → SIMPLE_GENERATE mode (Level 1 context)
 */
export interface ContextRoute {
    mode: 'CONVERT_TEXT' | 'MODIFY_LAYOUT' | 'STYLE_CHANGE' | 'GENERATE_COMPONENT' | 'GENERATE_PAGE' | 'SIMPLE_GENERATE';
    contextLevel: 1 | 2 | 3 | 4;
    injectComponentSpecs: boolean;
    injectLayoutRules: boolean;
    reason: string;
}

export function getContextRouting(
    intent: RecognizedIntent,
    selectionContext?: SelectionContext
): ContextRoute {
    const hasSelection = selectionContext && selectionContext.count > 0;
    const hasTextSelection = hasSelection && selectionContext.primaryType === 'TEXT';
    const hasContainerSelection = hasSelection && 
        (selectionContext.primaryType === 'FRAME' || selectionContext.primaryType === 'GROUP');

    // Branch 1: Has Selection
    // Branch 1: Has Selection
    if (hasSelection) {
        // Selection present? ALWAYS provide context.
        // Don't arbitrarily limit context level based on node type.
        // The LLM needs to see the layout rules even if it's just a text node,
        // in case the user wants to wrap it in a frame.
        
        let mode: ContextRoute['mode'] = 'GENERATE_COMPONENT';
        if (hasTextSelection) mode = 'CONVERT_TEXT';
        else if (intent.type === 'MODIFY_EXISTING') mode = 'MODIFY_LAYOUT';
        else if (intent.type === 'APPLY_STYLE') mode = 'STYLE_CHANGE';

        return {
            mode,
            contextLevel: 2, // Default to richer context
            injectComponentSpecs: intent.target !== undefined,
            injectLayoutRules: true, // Always helpful
            reason: 'Selection active -> providing standard context with layout rules'
        };
    }

    // Branch 2: No Selection
    // Check for page/layout keywords to bump context level
    const isPageRequest = intent.type === 'GENERATE_COMPONENT' && (
        !intent.target || 
        ['Dashboard', 'Page', 'Screen', 'Layout'].includes(intent.target || '')
    );

    if (isPageRequest) {
        return {
            mode: 'GENERATE_PAGE',
            contextLevel: 3,
            injectComponentSpecs: true,
            injectLayoutRules: true,
            reason: 'Page generation request -> full context'
        };
    }

    // Default: Standard Generation
    return {
        mode: 'GENERATE_COMPONENT', // Unified mode
        contextLevel: 2,
        injectComponentSpecs: true, // Likely needed for generation
        injectLayoutRules: true,
        reason: 'Standard generation -> helpful context'
    };
}
