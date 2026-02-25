/**
 * @file textRenderer.ts
 * @description TEXT Node Renderer - Handles fonts, text content, styling
 * 
 * Updated to support extended typography properties: 
 * letterSpacing, paragraphSpacing, textCase, textDecoration.
 */

import { BaseRenderer, NodeLayer, RenderContext, NodeLayerProps } from './baseRenderer';
import { fontBus } from '../resources/FontBus';
import { PropertyTransformer } from '../propertyTransformer';
import { PROPS } from '../../../constants/figma-api';
import { isAbsolutePositioned, getFlexFallbacks } from '../../utils/LayoutValidator';

/**
 * TextRenderer - Renders TEXT nodes with font loading
 */
export class TextRenderer extends BaseRenderer {
    private loadedFonts: Set<string> = new Set();

    constructor(createPaintFn: (color: string | Record<string, any>) => Promise<Paint | null>) {
        super(createPaintFn);
    }

    protected getRendererName(): string {
        return 'TextRenderer';
    }

    protected async createNode(dsl: NodeLayer): Promise<TextNode | null> {
        const family = PropertyTransformer.deserialize(dsl.props.fontFamily || 'Inter', PROPS.fontFamily);
        const style = PropertyTransformer.deserialize(dsl.props.fontWeight || 'Regular', PROPS.fontWeight);

        // [FontBus] Centralized Loading
        await fontBus.getOrLoad(family, style);
        return figma.createText();
    }

    protected async applyTypeSpecificProps(
        node: SceneNode,
        dsl: NodeLayer,
        context: RenderContext
    ): Promise<void> {
        const t = node as TextNode;
        const props = dsl.props;

        // ========== Font ==========
        const family = PropertyTransformer.deserialize(props.fontFamily || 'Inter', PROPS.fontFamily);
        const style = PropertyTransformer.deserialize(props.fontWeight || 'Regular', PROPS.fontWeight);

        try {
            // Check if font is actually loaded via Bus
            if (fontBus.isLoaded(family, style)) {
                t.fontName = { family, style };
            } else {
                throw new Error('Font not in Bus');
            }
        } catch (e) {
            // Fallback to Inter Regular (Bus ensures it's always ready during warmup)
            t.fontName = { family: 'Inter', style: 'Regular' };
        }

        // ========== Content ==========
        t.characters = PropertyTransformer.deserialize(props.characters || (props as any).content || '', PROPS.characters);

        // ========== Size ==========
        if (props.fontSize) {
            t.fontSize = props.fontSize;
        }

        // ========== Line Height ==========
        this.applyLineHeight(t, props);

        // ========== Color ==========
        this.applyColor(t, props);

        // ========== Sizing Mode ==========
        // (Figma restriction: FILL/HUG only valid on children of auto-layout frames)
        const parentIsAutoLayout = context.parentLayoutMode !== undefined && context.parentLayoutMode !== 'NONE';
        const hSizing = props.layoutSizingHorizontal || 'HUG';
        const vSizing = props.layoutSizingVertical || 'HUG';

        if (parentIsAutoLayout) {
            t.layoutSizingHorizontal = hSizing;
            t.layoutSizingVertical = vSizing;

            if (!isAbsolutePositioned(props)) {
                const flex = getFlexFallbacks(hSizing, vSizing, context.parentLayoutMode);
                if (flex.layoutGrow !== undefined) t.layoutGrow = flex.layoutGrow;
                if (flex.layoutAlign) t.layoutAlign = flex.layoutAlign;
            }
        }

        // Text-specific resize behavior
        if (hSizing === 'FILL') {
            // V6 FIX: Only force HEIGHT resize (which enables wrapping) if text is long
            // This prevents short labels from collapsing vertically in flexible parents.
            const content = props.characters || props.content || '';
            const isLongText = content.length > 60 || content.includes('\n');
            const forceWrap = (props as any).wrap === true;

            if (isLongText || forceWrap) {
                t.textAutoResize = 'HEIGHT';
            } else {
                // [PURE TRUST] Removed V6 SAFETY block.
                // If LLM requests FILL for short text, we respect it.
                // It is the LLM's responsibility to handle sizing correctly.
                /*
                // V6 SAFETY: If text is short and parent is auto-layout, 
                // using FILL + WIDTH_AND_HEIGHT can sometimes cause collapse to 1px if the parent width is undefined.
                // We fallback to HUG (WIDTH_AND_HEIGHT) horizontal sizing to ensure visibility.
                if (parentIsAutoLayout) {
                    t.layoutSizingHorizontal = 'HUG';
                }
                */
                t.textAutoResize = 'WIDTH_AND_HEIGHT';
            }
        } else if (hSizing === 'HUG') {
            t.textAutoResize = 'WIDTH_AND_HEIGHT';
        } else if (hSizing === 'FIXED' && props.width) {
            t.textAutoResize = 'HEIGHT';
            const targetW = PropertyTransformer.deserialize(props.width, PROPS.width);
            t.resize(Math.max(1, targetW), t.height || 20);
        }
        
        // Explicit dimensions override (for FIXED mode)
        if (props.width && props.height && hSizing === 'FIXED') {
            const targetW = PropertyTransformer.deserialize(props.width, PROPS.width);
            const targetH = PropertyTransformer.deserialize(props.height, PROPS.height);
            t.resize(Math.max(1, targetW), Math.max(1, targetH));
            t.textAutoResize = 'NONE';
        }

        // [FIX] Extended Typography Properties
        const p = props as any;

        // Letter Spacing
        if (p.letterSpacing) {
            if (typeof p.letterSpacing === 'number') {
                t.letterSpacing = { value: p.letterSpacing, unit: 'PIXELS' };
            } else if (typeof p.letterSpacing === 'object') {
                t.letterSpacing = p.letterSpacing;
            }
        }

        // Paragraph Spacing
        if (typeof p.paragraphSpacing === 'number') {
            t.paragraphSpacing = p.paragraphSpacing;
        }
        if (typeof p.paragraphIndent === 'number') {
            t.paragraphIndent = p.paragraphIndent;
        }

        // Text Case
        if (p.textCase) {
             t.textCase = p.textCase as TextCase;
        }

        // Text Decoration
        if (p.textDecoration) {
            t.textDecoration = p.textDecoration as TextDecoration;
        }
        
        // Text Align (Explicit)
        // Note: horizontal align is often handled by auto-layout, but explicit is needed for fixed text
        if (p.textAlignHorizontal) t.textAlignHorizontal = p.textAlignHorizontal;
        if (p.textAlignVertical) t.textAlignVertical = p.textAlignVertical;

        // Text Truncation (ellipsis)
        if (p.textTruncation === 'ENDING') {
            t.textTruncation = 'ENDING';
            if (typeof p.maxLines === 'number' && p.maxLines > 0) {
                t.maxLines = p.maxLines;
            }
            // Auto-set TRUNCATE mode if not explicitly set to a compatible value
            if (!p.textAutoResize || p.textAutoResize === 'WIDTH_AND_HEIGHT') {
                t.textAutoResize = 'TRUNCATE';
            }
        }
    }

    // ==========================================
    // PRIVATE HELPERS
    // ==========================================

    private applyLineHeight(t: TextNode, props: NodeLayerProps): void {
        if (!props.lineHeight) return;

        if (typeof props.lineHeight === 'object') {
            if (props.lineHeight.unit === 'PERCENT') {
                t.lineHeight = { value: props.lineHeight.value, unit: 'PERCENT' };
            } else {
                t.lineHeight = { value: props.lineHeight.value, unit: 'PIXELS' };
            }
        } else if (typeof props.lineHeight === 'number') {
            t.lineHeight = { value: props.lineHeight, unit: 'PIXELS' };
        }
    }

    private async applyColor(t: TextNode, props: NodeLayerProps): Promise<void> {
        const colorStr = props.color || props.fills?.[0];
        if (!colorStr) return;

        const paint = await this.createPaintFn(colorStr);
        if (paint) {
            t.fills = [paint];
        }
    }
}
