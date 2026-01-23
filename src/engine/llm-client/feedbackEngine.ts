/**
 * @file feedbackEngine.ts
 * @description Engine for generating post-generation metadata and feedback.
 * 
 * Logic decoupled from useChat hook.
 */

import { NodeLayer } from '../../schema/layerSchema';
import { t } from '../../ui/i18n';

import { ChatMessage, CorrectionLog } from '../../types/chat';


/**
 * Counts the total number of elements in a layer tree.
 */
export function countElements(node: NodeLayer): number {
    let count = 1;
    if (node.children) {
        count += node.children.reduce((s: number, c: NodeLayer) => s + countElements(c), 0);
    }
    return count;
}

/**
 * Recursively collects all CorrectionLog entries from a sanitized layer tree.
 * P2 Feature: Enables feedback loop with LLM about post-processing corrections.
 */
export function collectCorrections(node: any): CorrectionLog[] {
    const corrections: CorrectionLog[] = [];
    
    // Collect corrections from this node
    if (node._corrections && Array.isArray(node._corrections)) {
        corrections.push(...node._corrections);
    }
    
    // Recursively collect from children
    if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
            corrections.push(...collectCorrections(child));
        }
    }
    
    return corrections;
}

/**
 * Infers the UI component type from the prompt text.
 */
export function detectComponentType(prompt: string): string {
    const lp = prompt.toLowerCase();
    const typeKeywords = [
        'dashboard', 'login', 'settings', 'profile', 'form', 
        'product', 'list', 'card', 'button', 'nav', 'header'
    ];
    
    for (const key of typeKeywords) {
        if (lp.includes(key)) return key;
    }
    return 'design';
}

/**
 * Generates the chat feedback object.
 * P2 Feature: Now includes corrections array for LLM feedback loop.
 */
export function generateChatFeedback(prompt: string, nodeData: NodeLayer, systemName?: string, rawOutput?: string): ChatMessage {

    const lp = prompt.toLowerCase();
    const elementCount = countElements(nodeData);
    const detectedType = detectComponentType(lp);
    
    const summary = t.createdDesign(detectedType, elementCount);
    const meta = (nodeData as any).meta; // Optional meta from LLM
    
    // P2: Collect corrections from sanitized layer tree
    const corrections = collectCorrections(nodeData);
    
    const inferDesignSystem = (): string => {
        if (meta?.designSystem) return meta.designSystem;
        return systemName || 'Unknown';
    };
    
    const inferStyle = (): string => {
        if (meta?.styleVariant) return meta.styleVariant;
        if (lp.includes('dark')) return 'Dark mode';
        if (lp.includes('light')) return 'Light mode';
        return 'Default';
    };
    
    const inferIconSource = (): string => {
        if (meta?.iconStyle) return meta.iconStyle;
        if (lp.includes('sf symbol')) return 'SF Symbols';
        if (lp.includes('material icon')) return 'Material Icons';
        if (lp.includes('lucide')) return 'Lucide';
        return 'None';
    };
    
    const suggestions = [];
    if (!lp.includes('dark')) suggestions.push('dark mode variant');
    if (!lp.includes('responsive')) suggestions.push('responsive layout');
    
    return {
        role: 'model',
        text: summary,
        rawOutput,
        corrections: corrections.length > 0 ? corrections : undefined,
        thinking: {

            designSystem: inferDesignSystem(),
            style: inferStyle(),
            iconSource: inferIconSource(),
            constraints: meta?.constraints || ['8pt grid alignment', 'Semantic token binding'],
            rationale: suggestions.length > 0 
                ? `Try: "${suggestions.slice(0, 2).join('" or "')}"` 
                : undefined,
        }
    };
}

