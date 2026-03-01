import { describe, expect, it } from 'vitest';
import { NodeLayer } from '../../../schema/layerSchema';
import { DslToActionAdapter } from '../dslAdapter';
import { CreateFrameAction, CreateTextAction, CreateIconAction, CreateShapeAction } from '../types';

describe('DslToActionAdapter', () => {
    it('should convert a simple frame with text', () => {
        const dsl: NodeLayer = {
            id: 'root-1',
            type: 'FRAME',
            name: 'Button',
            props: {
                width: 100,
                height: 48,
                layoutMode: 'HORIZONTAL',
                gap: 8,
                background: ['#FF0000']
            },
            children: [
                {
                    id: 'text-1',
                    type: 'TEXT',
                    props: {
                        content: 'Click Me',
                        fontSize: 14,
                        textAlign: 'CENTER'
                    }
                }
            ]
        };

        const actions = DslToActionAdapter.convert(dsl);
        
        expect(actions.length).toBe(2);
        
        const frameAction = actions[0] as CreateFrameAction;
        expect(frameAction.action).toBe('createFrame');
        expect(frameAction.tempId).toBe('root-1');
        expect(frameAction.props.width).toBe(100);
        expect(frameAction.props.itemSpacing).toBe(8);
        expect(frameAction.props.fills).toEqual(['#FF0000']);
        expect((frameAction.props as any).gap).toBeUndefined();
        expect((frameAction.props as any).background).toBeUndefined();

        const textAction = actions[1] as CreateTextAction;
        expect(textAction.action).toBe('createText');
        expect(textAction.parentId).toBe('root-1');
        expect(textAction.tempId).toBe('text-1');
        expect(textAction.props.characters).toBe('Click Me');
        expect(textAction.props.fontSize).toBe(14);
        expect(textAction.props.textAlignHorizontal).toBe('CENTER');
        expect((textAction.props as any).content).toBeUndefined();
        expect((textAction.props as any).textAlign).toBeUndefined();
    });

    it('should assign random tempIds if missing', () => {
        const dsl: NodeLayer = {
            type: 'FRAME',
            props: { width: 100 },
            children: [
                { type: 'TEXT', props: { content: 'hello' } }
            ]
        };

        const actions = DslToActionAdapter.convert(dsl);
        expect(actions.length).toBe(2);
        
        expect(actions[0].tempId).toBeDefined();
        expect(actions[1].tempId).toBeDefined();
        expect(actions[1].parentId).toBe(actions[0].tempId);
    });

    it('should respect override parent ID', () => {
        const dsl: NodeLayer = {
            id: 'child',
            type: 'FRAME',
            props: {}
        };
        const actions = DslToActionAdapter.convert(dsl, 'explicit-parent');
        expect(actions[0].parentId).toBe('explicit-parent');
    });

    it('should map ICON nodes to createIcon actions', () => {
        const dsl: NodeLayer = {
            id: 'icon-1',
            type: 'ICON',
            props: {
                iconName: 'lucide:home',
                width: 20,
                height: 20
            }
        };

        const actions = DslToActionAdapter.convert(dsl);
        expect(actions).toHaveLength(1);

        const iconAction = actions[0] as CreateIconAction;
        expect(iconAction.action).toBe('createIcon');
        expect(iconAction.tempId).toBe('icon-1');
        expect(iconAction.props.iconName).toBe('lucide:home');
        expect(iconAction.props.width).toBe(20);
        expect(iconAction.props.height).toBe(20);
    });

    it('should map VECTOR nodes to createShape with VECTOR type', () => {
        const dsl: NodeLayer = {
            id: 'vector-1',
            type: 'VECTOR',
            props: {
                width: 24,
                height: 24
            }
        };

        const actions = DslToActionAdapter.convert(dsl);
        expect(actions).toHaveLength(1);

        const vectorAction = actions[0] as CreateShapeAction;
        expect(vectorAction.action).toBe('createShape');
        expect(vectorAction.shapeType).toBe('VECTOR');
    });
});
