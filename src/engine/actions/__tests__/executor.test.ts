import { describe, it, expect } from 'vitest';
import { ActionExecutor } from '../executor';

describe('ActionExecutor.applyProps', () => {
  it('warns when a property is unsupported on the target node type', async () => {
    const executor = new ActionExecutor();
    const textNode = {
      id: '1:1',
      type: 'TEXT',
      width: 120,
      height: 24,
      resize(width: number, height: number) {
        this.width = width;
        this.height = height;
      },
    };

    const { warnings } = await (executor as any).applyProps(textNode, {
      layoutSizingHorizontal: 'FILL',
    });

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const unsupportedWarn = warnings.find((w: any) => w.code === 'UNSUPPORTED_PROP');
    expect(unsupportedWarn).toBeDefined();
    expect(unsupportedWarn.message).toContain("layoutSizingHorizontal");
    expect(unsupportedWarn.message).toContain('TEXT');
  });
});
