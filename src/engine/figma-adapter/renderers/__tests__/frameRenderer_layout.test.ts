import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing FrameRenderer
vi.mock('../baseRenderer', () => {
    return {
        BaseRenderer: class {
            createPaintFn: any;
            constructor(createPaintFn: any) {
                this.createPaintFn = createPaintFn;
            }
            async applyFills() {}
            async applyStrokes() {}
            async applyEffects() {}
        },
        PropertyTransformer: {
            deserialize: vi.fn((val) => val),
            isEqual: vi.fn(() => false)
        },
        PROPS: {
            gap: 'itemSpacing',
            paddingTop: 'paddingTop',
            paddingRight: 'paddingRight',
            paddingBottom: 'paddingBottom',
            paddingLeft: 'paddingLeft'
        }
    };
});

// Mock other renderers to avoid import chain failures
vi.mock('../textRenderer', () => ({ TextRenderer: class {} }));
vi.mock('../vectorRenderer', () => ({ VectorRenderer: class {} }));
vi.mock('../instanceRenderer', () => ({ InstanceRenderer: class {} }));
vi.mock('../iconRenderer', () => ({ IconRenderer: class {} }));
vi.mock('../propertyTransformer', () => ({
    PropertyTransformer: {
        deserialize: vi.fn((val) => val),
        isEqual: vi.fn(() => false)
    }
}));
vi.mock('../../../constants/figma-api', () => ({
    PROPS: {},
    PROP_METADATA: {}
}));

import { FrameRenderer } from '../frameRenderer';

describe('FrameRenderer Layout Sizing Logic', () => {
    let renderer: FrameRenderer;
    let mockNode: any;
    let mockCreatePaint: any;

    beforeEach(() => {
        mockCreatePaint = vi.fn();
        renderer = new FrameRenderer(mockCreatePaint);
        
        // Mock Figma Node
        mockNode = {
            type: 'FRAME',
            layoutMode: 'NONE',
            width: 100,
            height: 100,
            resize: vi.fn(),
            // Properties we are testing
            _hSizing: 'FIXED',
            _vSizing: 'FIXED',
            set layoutSizingHorizontal(v: any) { this._hSizing = v; },
            get layoutSizingHorizontal() { return this._hSizing; },
            set layoutSizingVertical(v: any) { this._vSizing = v; },
            get layoutSizingVertical() { return this._vSizing; }
        };

        // Universal Mock for Figma global
        (global as any).figma = {
            createFrame: vi.fn().mockReturnValue(mockNode)
        };
    });

    it('should demote HUG to FIXED if node has no layoutMode', async () => {
        const dsl = {
            type: 'FRAME',
            props: {
                name: 'Test Frame',
                layoutMode: 'NONE',
                layoutSizingHorizontal: 'HUG',
                layoutSizingVertical: 'HUG'
            },
            children: []
        };

        const context: any = {
            parent: {} as any,
            depth: 1, // Not root
            parentLayoutMode: 'NONE'
        };

        // We call the private method via any casting for unit testing the logic
        (renderer as any).applyLayoutSizing(mockNode, dsl, context);

        expect(mockNode.layoutSizingHorizontal).toBe('FIXED');
        expect(mockNode.layoutSizingVertical).toBe('FIXED');
    });

    it('should demote FILL to FIXED/HUG if parent has no layoutMode', async () => {
        const dsl = {
            type: 'FRAME',
            props: {
                name: 'Child Frame',
                layoutSizingHorizontal: 'FILL',
                layoutSizingVertical: 'FILL'
            },
            children: []
        };

        const context: any = {
            parent: {} as any,
            depth: 1,
            parentLayoutMode: 'NONE'
        };

        (renderer as any).applyLayoutSizing(mockNode, dsl, context);

        // First demoted from FILL to HUG (because it's a child)
        // Then demoted from HUG to FIXED (because it has no layoutMode)
        expect(mockNode.layoutSizingHorizontal).toBe('FIXED');
        expect(mockNode.layoutSizingVertical).toBe('FIXED');
    });

    it('should allow HUG if node has layoutMode', async () => {
        const dsl = {
            type: 'FRAME',
            props: {
                name: 'AutoLayout Frame',
                layoutMode: 'HORIZONTAL',
                layoutSizingHorizontal: 'HUG'
            },
            children: []
        };
        
        mockNode.layoutMode = 'HORIZONTAL';

        const context: any = {
            parent: {} as any,
            depth: 1,
            parentLayoutMode: 'NONE'
        };

        (renderer as any).applyLayoutSizing(mockNode, dsl, context);

        expect(mockNode.layoutSizingHorizontal).toBe('HUG');
    });

    it('should fallback to FIXED and not throw if an error occurs during property setting', async () => {
        const dsl = {
            type: 'FRAME',
            props: {
                name: 'Error Frame',
                layoutMode: 'HORIZONTAL',
                layoutSizingHorizontal: 'HUG'
            },
            children: []
        };
        
        let throwCount = 0;
        // Mock a throw on property set that only throws the FIRST time
        Object.defineProperty(mockNode, 'layoutSizingHorizontal', {
            set: (v) => { 
                if (throwCount === 0) {
                    throwCount++;
                    throw new Error('Figma API Crash'); 
                }
                mockNode._hSizing = v;
            },
            get: () => mockNode._hSizing,
            configurable: true
        });

        const context: any = {
            parent: {} as any,
            depth: 1,
            parentLayoutMode: 'NONE'
        };

        // This should NOT throw due to our try-catch block in FrameRenderer
        (renderer as any).applyLayoutSizing(mockNode, dsl, context);
        
        // Horizontal should have been set to FIXED in the catch block
        expect(mockNode.layoutSizingHorizontal).toBe('FIXED');
    });
});
