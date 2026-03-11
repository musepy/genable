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

    const warnings = await (executor as any).applyProps(textNode, {
      layoutSizingHorizontal: 'FILL',
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'UNSUPPORTED_PROP',
      severity: 'warning',
    });
    expect(warnings[0].message).toContain("layoutSizingHorizontal");
    expect(warnings[0].message).toContain('TEXT');
  });
});
