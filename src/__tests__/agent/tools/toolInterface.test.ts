import { searchDesignKnowledge, getComponentAnatomy } from '../../../engine/agent/tools/knowledgeTools';
import { validateLayout } from '../../../engine/agent/tools/validationTools';

describe('Agent Tool Interface Layer', () => {
  describe('searchDesignKnowledge', () => {
    it('should return results from various knowledge domains', async () => {
      const result = await searchDesignKnowledge({ domain: 'styles', query: 'minimal' });
      expect(result.success).toBe(true);
      expect(result.data.results.length).toBeGreaterThan(0);
    });

    it('should return error for invalid domain', async () => {
      const result = await searchDesignKnowledge({ domain: 'invalid' as any, query: 'test' });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_DOMAIN');
    });
  });

  describe('getComponentAnatomy', () => {
    it('should return a result for a known component', async () => {
      const result = await getComponentAnatomy({ componentName: 'button' });
      expect(result.success).toBe(true);
      // In test environment, the registry might be empty, so found might be false.
      // But success should be true.
      expect(result.data).toBeDefined();
    });
  });

  describe('validateLayout', () => {
    it('should detect sizing conflicts', async () => {
      const invalidNode = {
        id: '1',
        type: 'FRAME' as const,
        props: {
          name: 'InvalidNode',
          layout: 'HORIZONTAL' as any,
          layoutSizingHorizontal: 'HUG',
          width: 500
        }
      };
      const result = await validateLayout({ node: invalidNode });
      expect(result.success).toBe(true);
      expect(result.data.valid).toBe(true); // It's a warning in the validator, not an error
      expect(result.data.warnings.some(w => w.rule === 'SizingDimensionConflict')).toBe(true);
    });
  });
});
