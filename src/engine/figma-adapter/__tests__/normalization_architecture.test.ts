import { describe, it, expect } from 'vitest';
import { PropertyTransformer } from '../propertyTransformer';
import { PROPS } from '../../../constants/figma-api';

describe('DSL 属性归一化层 (TDD)', () => {
    describe('数值钳位 (Scalar Clamping)', () => {
        it('应该将透明度 (opacity) 限制在 0-1 之间', () => {
            // 输入 1.5 -> 应该纠正为 1
            expect(PropertyTransformer.deserialize(1.5, PROPS.opacity)).toBe(1);
            // 输入 -0.5 -> 应该纠正为 0
            expect(PropertyTransformer.deserialize(-0.5, PROPS.opacity)).toBe(0);
        });

        it('应该将字号 (fontSize) 限制在最小 1 像素', () => {
            expect(PropertyTransformer.deserialize(0, PROPS.fontSize)).toBe(1);
            expect(PropertyTransformer.deserialize(-5, PROPS.fontSize)).toBe(1);
            expect(PropertyTransformer.deserialize(12, PROPS.fontSize)).toBe(12);
        });

        it('应该将描边粗细 (strokeWeight) 限制在非负值且有上限', () => {
            expect(PropertyTransformer.deserialize(-1, PROPS.strokeWeight)).toBe(0);
            expect(PropertyTransformer.deserialize(200, PROPS.strokeWeight)).toBe(100);
        });
    });

    describe('枚举验证 (Enum Validation)', () => {
        it('非法枚举值应该回退到 defaultValue 而非原始输入', () => {
            // 假设布局模式只有 HORIZONTAL, VERTICAL, NONE
            expect(PropertyTransformer.deserialize('INVALID_MODE', PROPS.layoutMode)).toBe('NONE');
        });
        
        it('合法的枚举值（不分大小写）应该通过并归一化', () => {
            expect(PropertyTransformer.deserialize('horizontal', PROPS.layoutMode)).toBe('HORIZONTAL');
        });
    });

    // describe('图标正方形强制 (Icon Force Square)', () => {
    //     // IconRenderer.ts 内部已实现 Math.max，此处主要通过集成测试/手动验证确认。
    // });
});
